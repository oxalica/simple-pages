/*
  LoginCfg: {
    username: String,
    password: String,
    repo: String,
    branch: String,
  }
  Article: {
    name: String,
    title: String,
    isoPubtime: String,
    tags: [String],
    source: String | undefined,
  }
  Brief: { renderedBrief: String }
  Source: { source: String }
  ArticlePatch extends ArticleMonitored & Brief {
    removed: boolean,
  }
  Rendered: Brief & { rendered: String }
  Html: { html: String }
  Marker: <T>(T & Article & Source) => T & Article & Source & Rendered
  File: {
    path: String,
    content: String,
  }
*/

class Article {
  constructor(o, stripProps) {
    const def = {
      name: '',
      title: '',
      isoPubtime: new Date().toISOString(),
      tags: [],
      source: undefined,
    };
    Object.defineProperty(this, '_baseProps', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.keys(def),
    });
    if(stripProps)
      o = _.pick(o, Object.keys(def));
    Object.assign(this, def, o);
  }

  getBase() {
    return _.pick(this, this._baseProps);
  }
}

class MonitoredArticle extends Article {
  constructor(o, saved) {
    super(o);
    Object.defineProperty(this, 'lastVersion', {
      configurable: false,
      enumerable: false,
      writable: true,
      value: undefined,
    });
    this.lastVersion = undefined;
    if(saved)
      this.saveCurrent();
  }

  get modified() {
    return !this.lastVersion ||
           !_.isEqual(_.pick(this, this._baseProps),
                      this.lastVersion);
  }

  saveCurrent(prop) {
    this.lastVersion = _.cloneDeep(_.pick(this, this._baseProps));
  }

  saveCurrentProp(prop) {
    if(this._baseProps.indexOf(prop) === -1)
      throw new TypeError('Invalid monitored property');
    if(!this.lastVersion)
      throw new TypeError('No saved version');
    this.lastVersion[prop] = _.cloneDeep(this[prop]);
  }

  recover() {
    if(!this.lastVersion)
      throw new TypeError('No saved version');
    Object.assign(this, _.cloneDeep(this.lastVersion));
  }

  getBrief() {
    return _.pick(this, 'name,title,isoPubtime,tags,renderedBrief'.split(','));
  }
}

class GhBlog {
  constructor(repo, branch, commitResponse) {
    this.markerFile = 'simple-pages.init';
    this.indexFile = 'index.json';
    this.articleTemplFile = 'article.templ';
    this.articlePrefix = 'articles/';
    this._repo = repo;
    this._branch = branch;
    this._headCommitSha = commitResponse.commit.sha;
    this._headTreeSha = commitResponse.commit.commit.tree.sha;
    this._articleTempl = undefined;
    this._articleIndex = undefined; /* [Article & Brief] */
  }

  static load(loginCfg/* LoginCfg */) { // => Promise<GhBlog>
    let gh = new GitHub({
      username: loginCfg.username,
      password: loginCfg.password,
    });
    let repo = gh.getRepo(loginCfg.username, loginCfg.repo);
    return repo
      .getBranch(loginCfg.branch)
      .then(response => new GhBlog(
        repo,
        loginCfg.branch,
        response.data,
      ), err => {
        function logErr() { console.error(err); }
        switch(err.response && err.response.status) {
          case 401: logErr(); throw new Error('Authentication failed');
          case 404: logErr(); throw new Error('Repository or branch not found');
          default:  throw err;
        }
      })
      .then(ghb => {
        return ghb
          .reload()
          .catch(err => { // Load fail. Leave everything unchanged
            console.warn(err);
            return ghb;
          });
      });
  }

  get available() {
    return this._articleIndex !== undefined;
  }

  _checkAvailable() {
    if(!this.available)
      throw new TypeError('Unavailable method');
  }

  getIndexMonitored() {
    this._checkAvailable();
    return this._articleIndex.map(o => new MonitoredArticle(o, true));
  }

  reload() { // => Promise<this>
    this._articleIndex = undefined;
    return this
      ._readFile(this.markerFile)
      .then(() => this._readFile(this.indexFile))
      .then(cont => {
        try {
          this._articleIndex = JSON.parse(cont)
                                   .map(o => new Article(o));
          return this;
        } catch(err) {
          throw new Error('Invalid index file');
        }
      });
  }

  doInit(initFiles/* [File] */) { // => Promise<this>
    return this._writeFiles(initFiles, 'init');
  }

  _readFile(path) {
    return this._repo
      .getContents(this._headCommitSha, path, false)
      .then(response => atob(response.data.content));
  }

  _writeFiles(files/* [File] */, commitMsg) { // => Promise<this>
    const deltas = files.map(o => {
      return {
        path: o.path,
        mode: '100644', // type file
        type: 'blob',
        content: o.content,
      };
    });
    let newTreeSha, newCommitSha;
    return this._repo
      .createTree(deltas, this._headTreeSha)
      .then(response => {
        newTreeSha = response.data.sha;
        return this._repo.commit(
          this._headCommitSha,
          newTreeSha,
          commitMsg,
        );
      })
      .then(response => {
        newCommitSha = response.data.sha;
        return this._repo.updateHead(
          'heads/' + this._branch,
          newCommitSha,
          false, // no force push
        );
      })
      .then(() => {
        this._headCommitSha = newCommitSha;
        this._headTreeSha = newTreeSha;
        return this;
      });
  }

  loadArticle/*<T>*/(article/* T & Article */) { // => Promise<T & Article & Source>
    this._checkAvailable();
    return this
      ._readFile(this.articlePrefix + article.name)
      .then(html => this._extractArticleSource(html))
      .then(source => {
        article.source = source;
        return article;
      });
  }

  saveArticles(allArticles/* [ArticlePatch] */,
               marker/* Marker */,
               commitMsg/* String */
              ) { // => Promise<this>
    this._checkAvailable();
    const modifieds = allArticles.filter(c => c.modified);
    return this
      ._renderArticleHtmls(modifieds, marker)
      .then(modifieds/* [ArticlePatch & Html] */ => {
        let files = modifieds.map(cur => ({
          path: this.articlePrefix + cur.name,
          content: cur.html,
        }));
        files.push({
          path: this.indexFile,
          content: JSON.stringify(
            allArticles,
            (k, v) => v instanceof Article ? v.getBrief() : v,
          ),
        });
        return this
          ._writeFiles(files, commitMsg)
          .then(() => {
            this._articleIndex =
              allArticles.map(c => {
                const nc = new Article(c, true);
                nc.renderedBrief = c.renderedBrief;
                return nc;
              });
            return this;
          });
      });
  }

  _renderArticleHtmls/*<T>*/(articles/* [T & Article & Source] */,
                             marker/* Marker */
                            ) { // => Promise<[T & Article & Source & Html]>
    return Promise.resolve()
      .then(() => this._articleTempl || this._readFile(this.articleTemplFile))
      .then(templ => {
        this._articleTempl = templ;
        articles.forEach(c => {
          marker(c);
          c.html = `<!-- SOURCE<${window.btoa(c.source)}> -->` +
                   Mustache.render(templ, c);
        });
        return articles;
      });
  }

  _extractArticleSource(html) { // => Promise<String>
    return Promise.resolve()
      .then(() => { // for catching exceptions
        let raw = /<!-- SOURCE<(.*?)> -->/.exec(html)[1];
        if(raw === undefined)
          throw new Error('No source found in article file');
        return window.atob(raw);
      });
  }
}
