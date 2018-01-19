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
    source: String,
  }
  ArticleRendered: {
    renderedBrief: String,
    rendered: String,
    ..Article
  }
  ArticleBrief: {
    name: String,
    title: String,
    isoPubtime: String,
    tags: [String],
    renderedBrief: String,
  }
  Index: [ArticleBrief]
  File: {
    path: String,
    content: String,
  }
*/

class GhBlog {
  constructor(repo, branch, commitResponse) {
    this.markerFile = '.simple-pages';
    this.indexFile = 'index.json';
    this.articleTemplFile = 'article.templ';
    this.articlePrefix = 'articles/';
    this._repo = repo;
    this._branch = branch;
    this._headCommitSha = commitResponse.commit.sha;
    this._headTreeSha = commitResponse.commit.commit.tree.sha;
    this._articleTempl = undefined;
    this._index = undefined; // Index
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
      .then(ghb => ghb._tryLoad());
  }

  get available() { // => Boolean
    return this._index !== undefined;
  }

  _checkAvailable() {
    if(!this.available)
      throw new TypeError('Unavailable method');
  }

  get index() { // => Index
    this._checkAvailable();
    return this._index;
  }

  _tryLoad() { // => Promise<this> (always success)
    return this
      ._readFile(this.markerFile)
      .then(() => this._readFile(this.indexFile))
      .then(cont => {
        let index = JSON.parse(cont);
        if(!(index instanceof Array))
          throw new Error('Invalid index file');
        return index;
      })
      .then(index => {
        this._index = index;
        return this;
      }, err => { // Fail with everything unchanged
        console.warn(err);
        return this;
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

  readArticle(name) { // => Promise<Article | null>
    this._checkAvailable();
    let brief = this._index.find(o => o.name === name);
    if(brief === undefined)
      return Promise.resolve(null);
    return this
      ._readFile(this.articlePrefix + name)
      .then(html => this._extractArticleSource(html))
      .then(source => {
        return {
          name,
          title: brief.title,
          isoPubtime: brief.isoPubtime,
          tags: brief.tags.slice(), // clone
          source,
        };
      });
  }

  writeArticle(article/* ArticleRendered */, commitMsg) { // => Promise<this>
    this._checkAvailable();
    return this
      ._renderArticleHtml(article)
      .then(html => {
        let brief = {
          name: article.name,
          title: article.title,
          isoPubtime: article.isoPubtime,
          tags: article.tags.slice(), // clone
          renderedBrief: article.renderedBrief,
        };
        let oldIdx = this._index.findIndex(o => o.name === article.name);
        if(oldIdx !== -1)
          this._index[oldIdx] = brief;
        else
          this._index.push(brief);
        this._writeFiles([{
          path: this.indexFile,
          content: JSON.stringify(this._index),
        }, {
          path: this.articlePrefix + article.name,
          content: html,
        }], commitMsg);
      })
  }

  _renderArticleHtml(article/* ArticleRendered */) { // => Promise<String>
    return Promise.resolve()
      .then(() => this._articleTempl || this._readFile(this.articleTemplFile))
      .then(templ => `<!-- SOURCE<${window.btoa(article.source)}> -->` +
                      Mustache.render(templ, article))
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
