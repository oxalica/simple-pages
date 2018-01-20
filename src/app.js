(function() {
  'use strict';

  function checkAll(arr) {
    return arr.reduce((st, f) => f() && st, true);
  }

  Vue.component('loginPage', {
    template: '#templ-login-page',
    data: function() {
      return {
        username: '',
        password: '',
        repo: '',
        branch: 'master',
        checkers: [],
        logining: false,
        errorMsg: null,
      };
    },
    methods: {
      addChecker: function(checker) {
        this.checkers.push(checker);
      },
      login: function() {
        if(this.logining)
          throw new TypeError('Double login');
        if(!checkAll(this.checkers))
          return;
        this.logining = true;
        this.errorMsg = null;

        let loginCfg = {
          username: this.username,
          password: this.password,
          repo: this.repo,
          branch: this.branch,
        };
        GhBlog.load(loginCfg)
              .then(ghBlog => {
                if(!ghBlog.available)
                  throw new Error('Not initialized by simple-pages');
                this.$emit('success', ghBlog);
              })
              .catch(err => {
                this.errorMsg = err.message;
                console.error(err);
              })
              .then(() => this.logining = false);
      },
    },
  });

  Vue.component('mainPage', {
    template: '#templ-main-page',
    props: {
      ghBlogIn: { required: true, type: GhBlog },
    },
    data: function() {
      return {
        ghBlog: this.ghBlogIn,
        curArticle: {
          name: '',
          title: '',
          isoPubtime: '',
          tags: [],
          source: '',
        },
        checkers: [],
        waiting: false,
        errorMsg: null,
      };
    },
    computed: {
      strTags: {
        get: function() {
          return this.curArticle.tags.join(' ');
        },
        set: function(newVal) {
          const s = newVal.trim();
          this.curArticle.tags = (s ? s.split(/\s+/) : []);
        },
      },
    },
    methods: {
      addChecker: function(checker) {
        this.checkers.push(checker);
      },
      saveCurrentArticle: function() {
        if(this.waiting)
          throw new TypeError('Save when waiting');
        if(!checkAll(this.checkers))
          return;
        this.waiting = true;
        this.errorMsg = null;

        if(!(this.curArticle instanceof Article)) {
          this.curArticle = new Article(this.curArticle, true);
          this.ghBlog.articles.unshift(this.curArticle);
          console.log('New article added');
        }
        function marker(article) {
          const source = article.source;
          const match = /^([\s\S]*?)--+more--+([\s\S]*)$/.exec(source);
          article.renderedBrief = match ? marked(match[1]) : '';
          article.rendered = marked(match ? match[1] + match[2] : source);
          return article;
        }
        this.ghBlog.saveArticles(marker, 'Save')
            .then(() => {
              this.waiting = false;
              window.alert('Saved!')
            })
            .catch(err => {
              this.waiting = false;
              console.error(err);
              this.errorMsg = err.message;
            });
      },
      loadArticle: function() {
        if(this.waiting)
          throw new TypeError('Load when waiting');
        if(this.curArticle.changed !== false && !confirm('Discard current states?'))
          return;

        const base = this.ghBlog.articles
                         .find(o => o.name === this.curArticle.name);
        if(base === undefined) {
          this.errorMsg = 'Article not found';
          return;
        }

        this.waiting = true;
        this.errorMsg = null;
        if(this.curArticle instanceof Article)
          this.curArticle.reset();
        this.ghBlog.loadArticle(base)
            .then(cur => this.curArticle = cur)
            .catch(err => this.errorMsg = err.message)
            .then(() => this.waiting = false);
      },
    },
  });

  Vue.component('md-editor', {
    template: '#templ-md-editor',
    props: {
      value: String,
      readonly: Boolean,
      disabled: Boolean,
    },
    data: function() {
      return {
        renderedShown: '', // delayed show
      };
    },
    computed: {
      rendered: function() {
        return marked(this.value || '');
      },
    },
    watch: {
      rendered: _.debounce(function() {
        this.renderedShown = this.rendered;
      }, 500, { leading: true }),
    },
  });

  Vue.component('labeled-input', {
    template: '#templ-labeled-input',
    props: {
      id:    { required: true, type: String },
      label: { required: true, type: String },
      type:  { required: true, type: String },
      placeholder: String,
      value: String,
      readonly: Boolean,
      disabled: Boolean,
      nonempty: Boolean,
    },
    data: function() {
      return {
        hasError: false,
      };
    },
    created: function() {
      if(this.nonempty)
        this.$emit('checker', () => this.check());
    },
    watch: {
      value: function() {
        this.hasError = false;
      },
    },
    methods: {
      check: function() {
        this.hasError = (this.nonempty && this.value === '');
        return !this.hasError;
      },
    },
  });

  window.root = new Vue({
    el: '#app',
    data: {
      ghBlog: null,
    },
    methods: {
      loginSuccess: function(ghBlog) {
        this.ghBlog = ghBlog;
      },
    },
  });

})();
