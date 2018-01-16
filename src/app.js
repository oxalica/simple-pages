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
        },
      };
    },
  });

  Vue.component('md-editor', {
    template: '#templ-md-editor',
    props: ['value'],
    data: function() {
      return {
        content: this.value,
      };
    },
    computed: {
      rendered: function() {
        return '';
        throw undefined;
      },
    },
  });

  new Vue({
    el: '#app',
  });

})();
