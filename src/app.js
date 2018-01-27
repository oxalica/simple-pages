(function() {
  'use strict';

  Vue.use(VeeValidate);

  Vue.component('loginPage', {
    template: '#templ-login-page',
    props: {
      loginInfo: { required: true },
    },
    data: function() {
      return {
        initFiles: [
          'init/simple-pages.init',
          'init/index.json',
          'init/article.templ',
          'init/index.html',
          'init/css.css',
        ],
        saveKey: 'simplePagesLoginInfo',
        password: '',
        logining: false,

        errorMsg: null,
        showErrorMsg: false,
      };
    },
    mounted: function() {
      const last = localStorage.getItem(this.saveKey);
      if(last) {
        Object.assign(this.loginInfo, JSON.parse(last));
        this.$refs.password.focus();
      } else {
        this.$refs.username.focus();
      }
    },
    methods: {
      saveLoginInfo: function() {
        localStorage.setItem(this.saveKey, JSON.stringify(this.loginInfo));
      },
      onSubmit: function() {
        this.$validator.validateAll()
            .then(ret => ret && this.login());
      },
      login: function() {
        if(this.logining)
          throw new TypeError('Double login');

        this.logining = true;
        this.showErrorMsg = false;

        let loginCfg = {
          username: this.loginInfo.username,
          password: this.password,
          repo: this.loginInfo.repo,
          branch: this.loginInfo.branch,
        };
        GhBlog
          .load(loginCfg)
          .then(ghb => ghb.available ? ghb : this.checkDoInit(ghb))
          .then(ghb => {
            if(ghb && ghb.available) {
              this.saveLoginInfo();
              this.$emit('success', ghb);
            }
          })
          .catch(err => {
            console.error(err);
            this.errorMsg = `Failed!\n${err.message}`;
            this.showErrorMsg = true;
          })
          .then(() => this.logining = false);
      },
      checkDoInit: function(ghb) {
        if(!confirm('Not initialized by simple-pages! Init it now?\n' +
                    'DANGER: may replace your existing files')) {
          return undefined;
        }
        const reqs = this
          .initFiles
          .map(path => {
            return this.$http
              .get(path, { responseType: 'text' })
              .then(response => ({
                path: removeLeadingPath(path),
                content: response.bodyText,
              }))
              .catch(err => {
                throw new Error('Cannot load initial templates');
              });
          });
        return Promise.all(reqs)
          .then(files => ghb.doInit(files))
          .then(ghb => ghb.reload());
        function removeLeadingPath(s) {
          return s.slice(s.lastIndexOf('/') + 1);
        }
      },
    },
  });

  Vue.component('mainPage', {
    template: '#templ-main-page',
    props: {
      loginInfo: { default: undefined },
      ghBlogIn:  { required: true, type: GhBlog },
    },
    data: function() {
      const curIndex = this.ghBlogIn.getIndexMonitored();
      curIndex.forEach(o => o.removed = false);
      return {
        ghBlog: this.ghBlogIn,
        curIndex,
        curArticle: null,
        saving: false,

        errorMsg: null,
        showErrorMsg: false,
        showSaveMsg: false,
      };
    },
    computed: {
      saveKey: function() {
        if(this.loginInfo === undefined)
          return undefined;
        return 'simplePagesModifiedArticles|' +
               encodeURI(this.loginInfo.username) + '|' +
               encodeURI(this.loginInfo.repo) + '|' +
               encodeURI(this.loginInfo.branch);
      },
    },
    mounted: function() {
      if(this.saveKey === undefined)
        return;
      const savedObj = JSON.parse(localStorage.getItem(this.saveKey) || '[]');
      if(savedObj.length && confirm('Recover the last unsaved articles?')) {
        const notFounds = this.loadLocal(savedObj);
        if(notFounds > 0)
          this.$nextTick(() => {
            window.alert(
              `Cannot find bases of ${notFounds} recovered articles. ` +
              'They are marked as new articles now.'
            );
          });
      }
    },
    watch: {
      curIndex: {
        handler: _.throttle(function() {
          this.saveLocal();
        }, 3000),
        deep: true,
      },
    },
    methods: {
      saveLocal: function() {
        if(!this.saveKey)
          return;
        const s = JSON.stringify(this.getModifiedArticles(), (k, v) => {
          if(v instanceof Article) {
            const min = v.getBase();
            min.removed = v.removed;
            if(v.lastVersion)
              min.oldName = v.lastVersion.name;
            return min;
          } else
            return v;
        });
        localStorage.setItem(this.saveKey, s);
      },
      loadLocal: function(savedObj) {
        let baseNotFound = 0;
        savedObj
          .reverse() // unshift in reverse order
          .forEach(o => {
            const cur = new MonitoredArticle(o);
            if(o.oldName !== undefined) {
              const base = this.curIndex.find(t => t.name === o.oldName);
              if(base !== undefined) {
                this.ghBlog.loadArticle(base) // Load the source first, or recovering
                    .then(() => {        // will be broken
                      base.saveCurrentProp('source');
                      Object.assign(base, cur);
                    });
              } else {
                baseNotFound++;
                this.curIndex.unshift(cur);
              }
            } else
              this.curIndex.unshift(cur);
          });
        return baseNotFound;
      },
      checkInfo: function(article) {
        return article.name !== '' &&
               article.title !== '' &&
               article.isoPubtime !== '';
      },
      newArticle: function() {
        const article = new MonitoredArticle({ source: '', removed: false });
        this.curIndex.unshift(article);
        this.curArticle = article;
      },
      selectArticle: function(article) {
        this.curArticle = article;
        if(article.source === undefined) {
          this.ghBlog.loadArticle(article)
              .then(article => article.saveCurrentProp('source'));
        }
      },
      onRemove: function(article) {
        if(!article.lastVersion) {
          if(confirm('Remove the newly created article immediately?')) {
            this.curIndex = this.curIndex.filter(c => c !== article);
            this.curArticle = null;
          } else
            article.removed = false;
        }
      },
      saveAll: function() {
        if(this.saving)
          throw new TypeError('Save when saving');
        this.closeMsgs();

        const modifieds = this.getModifiedArticles();
        const modifiedCnt = modifieds.length;
        const orzed = modifieds.find(o => !this.checkInfo(o));
        if(orzed !== undefined) {
          this.curArticle = orzed;
          window.alert('Missing some required properties');
          return;
        } else if(modifiedCnt === 0) {
          window.alert('Nothing changed');
          return;
        } else if(!confirm(`Save ${modifiedCnt} articles?`))
          return;

        this.saving = true;
        const articleMarker =
          article => Object.assign(article, this.marker(article.source));
        const newIndex = this.curIndex.filter(c => !c.removed);
        this.ghBlog.saveArticles(this.curIndex, articleMarker, 'Save')
            .then(() => {
              this.showSaveMsg = true;
              newIndex.forEach(c => c.saveCurrent());
              this.curIndex = newIndex;
              this.saveLocal();
            })
            .catch(err => {
              console.error(err);
              this.errorMsg = `Failed!\n${err.message}`;
              this.showErrorMsg = true;
            })
            .then(() => this.saving = false);
      },
      closeMsgs: function() {
        this.showErrorMsg = this.showSaveMsg = false;
      },
      getModifiedArticles: function() {
        return this.curIndex.filter(o => o.removed || o.modified);
      },
      marker: function(source) {
        const match = /^([\s\S]*?)--+more--+([\s\S]*)$/.exec(source);
        const renderedBrief = match ? markWithMath(match[1]) : '';
        const renderedRest = markWithMath(match ? match[2] : source);
        return {
          renderedBrief,
          renderedRest,
          rendered: renderedBrief + renderedRest,
        };
        function markWithMath(s) {
          return marked(s)
            .replace(/\\\\\(([\s\S]*?)\\\\\)/g, (_, inner) => {
              try {
                return katex.renderToString(inner);
              } catch(e) {
                return `<span style="color: red">&lt;${e.message}&gt;</span>`;
              }
            });
        }
      },
    },
  });

  Vue.component('articleEditor', {
    template: '#templ-article-editor',
    props: {
      article:  { default: null, validator: v => v === null || v instanceof Article },
      readonly: { type: Boolean, default: false },
      disabled: { type: Boolean, default: false },
      marker:   { required: true },
    },
    computed: {
      isDisabled: function() {
        return this.disabled || !this.article;
      },
      sourceLoading: function() {
        return this.article && this.article.source === undefined;
      },
      resetDisabled: function() {
        return this.article && !this.article.lastVersion;
      },
      strTags: {
        get: function() {
          return this.article ? this.article.tags.join(' ') : '';
        },
        set: function(newVal) {
          if(this.article) {
            const s = newVal.trim();
            this.article.tags = (s ? s.split(/\s+/) : []);
          }
        },
      },
      name: {
        get: function() { this.revalidate(); return this.article ? this.article.name : ' '; },
        set: function(newVal) { if(this.article) this.article.name = newVal; },
      },
      title: {
        get: function() { this.revalidate(); return this.article ? this.article.title : ''; },
        set: function(newVal) { if(this.article) this.article.title = newVal; },
      },
      isoPubtime: {
        get: function() { this.revalidate(); return this.article ? this.article.isoPubtime : ''; },
        set: function(newVal) { if(this.article) this.article.isoPubtime = newVal; },
      },
      source: {
        get: function() { this.revalidate(); return this.article ? this.article.source : ''; },
        set: function(newVal) { if(this.article) this.article.source = newVal; },
      },
    },
    methods: {
      revalidate: function() {
        this.$nextTick(() => this.$validator.validateAll());
      },
      reset: function() {
        if(this.article) {
          if(this.article.modified &&
            confirm('Discard all modifications of this article?'))
            this.article.recover();
          else if(this.article.removed)
            this.article.removed = false;
        }
      },
      remove: function() {
        if(this.article) {
          this.article.removed = true;
          this.$emit('remove', this.article);
        }
      },
      onInput: function(prop, value) {
        if(this.article)
          this.article[prop] = value;
      },
    },
  });

  Vue.component('md-editor', {
    template: '#templ-md-editor',
    props: {
      value: String,
      readonly: Boolean,
      disabled: Boolean,
      marker: { required: true },
    },
    data: function() {
      return {
        renderedShown: '', // delayed show
      };
    },
    computed: {
      rendered: function() {
        return this.marker(this.value || '').rendered;
      },
    },
    watch: {
      rendered: _.debounce(function() {
        this.renderedShown = this.rendered;
      }, 500, { leading: true }),
    },
  });

  Vue.component('float-alert', {
    template: '#templ-float-alert',
    props: {
      show:     { type: Boolean, default: true },
      closable: { type: Boolean, default: false },
      duration: { type: Number,  default: 0 },
      width:    { type: String,  required: true },
    },
    data: function() {
      return {
        timerID: undefined,
      };
    },
    methods: {
      close: function() {
        this.removeTimer();
        this.$emit('update:show', false);
      },
      removeTimer: function() {
        clearTimeout(this.timerID);
        this.timerID = undefined;
      },
    },
    watch: {
      show: {
        handler: function(newVal) {
          if(!newVal)
            this.removeTimer();
          else if(this.duration > 0)
            this.timerID = setTimeout(() => this.close(), this.duration);
        },
        immediate: true,
      },
    },
  });

  window.root = new Vue({
    el: '#app',
    data: {
      ghBlog: null,
      loginInfo: {
        username: '',
        repo: '',
        branch: 'master',
      },
    },
    methods: {
      loginSuccess: function(ghBlog) {
        this.ghBlog = ghBlog;
      },
    },
  });

})();
