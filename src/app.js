(function() {
  'use strict';

  Vue.component('loginPage', {
    template: '#templ-login-page',
    data: function() {
      return {
        username: '',
        password: '',
        repo: '',
        branch: 'master',
      };
    },
  });

  Vue.component('mainPage', {
    template: '#templ-main-page',
    data: function() {
      return {
        curArticle: {
          filename: '',
          title: '',
          pubtime: '',
          content: '',
          rendered: '',
        },
      };
    },
  });

  Vue.component('md-editor', {
    template: '#templ-md-editor',
    props: {
      'value': String,
    },
    data: function() {
      return {
        renderedShown: '', // delayed show
      };
    },
    computed: {
      content: {
        get: function() {
          return this.value;
        },
        set: function(newContent) {
          this.$emit('input', newContent);
        },
      },
      rendered: function() {
        let r = marked(this.content);
        this.$emit('update-rendered', r);
        return r;
      },
    },
    watch: {
      rendered: _.debounce(function() {
        this.renderedShown = this.rendered;
      }, 500, { leading: true }),
    },
  });

  new Vue({
    el: '#app',
  });

})();
