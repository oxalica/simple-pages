/*
  LoginCfg: {
    username: String,
    password: String,
    repo: String,
    branch: String,
  }
  ArticleRenderedHtml: {
    ..ArticleRendered,
    html,
  }
  ArticleRendered: {
    ..ArticleSource,
    rendered: String,
    renderedBrief: String,
  }
  ArticleSource: {
    ..ArticleBase,
    source: String,
  }
  ArticleBase: {
    name: String,
    title: String,
    isoPubtime: String,
    tags: [String],
  }
  Marker: (s: ArticleSource) => (s: ArticleRendered)
  File: {
    path: String,
    content: String,
  }
*/

class Article {
  constructor(o) {
    if(o === undefined)
      o = {
        name: '',
        title: '',
        isoPubtime: new Date().toISOString(),
        tags: [],
        source: '',
      };
    Object.defineProperty(this, '_monitorProps', {
      enumerable: false,
      value: 'name,title,isoPubtime,tags,source'.split(','),
    });
    for(const p of 'name,title,isoPubtime,tags,source,rendered,renderedBrief,html'
                   .split(','))
      this[p] = o[p]; // pick or undefined
    this.changed = true;
  }

  getOld() {
    return this._last;
  }

  get changed() {
    if(this._last === undefined)
      return true;
    for(const p of this._monitorProps)
      if(!_.isEqual(this[p], this._last[p])) // may be Array
        return true;
    return false;
  }

  set changed(newVal) {
    Object.defineProperty(this, '_last', {
      configurable: true,
      enumerable: false,
      value: newVal ? undefined : _.cloneDeep(_.pick(this, this._monitorProps)),
    });
  }

  reset() {
    if(!this.resetable)
      throw new TypeError('Cannot reset');
    Object.assign(this, _.cloneDeep(this._last));
  }

  get resetable() {
    return this._last !== undefined;
  }

  toBrief() {
    return _.pick(this, 'name,title,isoPubtime,tags,renderedBrief'.split(','));
  }

  toMinimal() {
    return _.pick(this, 'name,title,isoPubtime,tags,source'.split(','));
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
    this.articles = undefined; /* [ArticleBase] */
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

  get available() { // => Boolean
    return this.articles !== undefined;
  }

  _checkAvailable() {
    if(!this.available)
      throw new TypeError('Unavailable method');
  }

  reload() { // => Promise<this>
    this.articles = undefined;
    return this
      ._readFile(this.markerFile)
      .then(() => this._readFile(this.indexFile))
      .then(cont => {
        try {
          this.articles = JSON.parse(cont)
                              .map(o => {
                                const c = new Article(o);
                                c.changed = false;
                                return c;
                              });
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

  loadArticle(articleBase/* ArticleBase */) { // => Promise<articleBase: ArticleSource>
    this._checkAvailable();
    if(articleBase.changed)
      throw new TypeError('Load to replace the modified article');
    return this
      ._readFile(this.articlePrefix + articleBase.name)
      .then(html => this._extractArticleSource(html))
      .then(source => {
        articleBase.source = source;
        articleBase.changed = false;
        return articleBase;
      });
  }

  changedCount() {
    return this.articles.filter(c => c.changed).length;
  }

  saveArticles(marker/* Marker */, commitMsg/* String */) { // => Promise<this>
    this._checkAvailable();
    const articles = this.articles.filter(c => c.changed);
    if(articles.length === 0)
      return Promise.resolve(this);
    return this
      ._renderArticleHtmls(articles, marker)
      .then(articles => { // articles: [ArticleRenderedHtml]
        let files = articles.map(cur => {
          return {
            path: this.articlePrefix + cur.name,
            content: cur.html,
          };
        });
        files.push({
          path: this.indexFile,
          content: this._getJSONIndex(),
        });
        return this
          ._writeFiles(files, commitMsg)
          .then(() => {
            articles.forEach(c => c.changed = false);
            return this;
          });
      });
  }

  _getJSONIndex() {
    return JSON.stringify(this.articles, (k, v) => {
      return v instanceof Article ? v.toBrief() : v;
    });
  }

  _renderArticleHtmls(articleSources/* [ArticleSource] */,
                      marker/* Marker */
                     ) { // => Promise<articleSources: [ArticleRenderedHtml]>
    return Promise.resolve()
      .then(() => this._articleTempl || this._readFile(this.articleTemplFile))
      .then(templ => {
        this._articleTempl = templ;
        articleSources.forEach(c => {
          marker(c);
          c.html = `<!-- SOURCE<${window.btoa(c.source)}> -->` +
                   Mustache.render(templ, c);
        });
        return articleSources;
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
