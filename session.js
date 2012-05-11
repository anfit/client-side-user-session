/*!
 * Client-side user session object, maintained by local (browser) 
 * storage and calls to a remote server. Provides e.g. openid 
 * login id for greasemonkey-based mashups.
 *
 * Copyright 2012, Jan Chimiak <jan.chimiak@gmail.com>
 * 
 * This document is licensed as free software under the terms of the
 * MIT License: http://www.opensource.org/licenses/mit-license.php
 */
(function (context) {

  // dependency check
  if(!context.$) {
    throw "ClientSideUserSession has an unmet dependency: jQuery";
  }
  if(!context.console) {
    throw "ClientSideUserSession has an unmet dependency: console";
  }
  
  // TODO document APIs and interfaces of configuration objects
  /**
   * Session singleton object
   * @class ClientSideUserSession
   * @singleton 
   * @depends console, jQuery
   * @param {Object} options
   */
  var ClientSideUserSession = function (options) {
  
    if (!options.url) {
      throw 'Wrong session config: url is undefined';
    }
    if (!options.store) {
      throw 'Wrong session config: store is undefined';
    }
    if (!options.ajax) {
      throw 'Wrong session config: ajax is undefined';
    }
    
    // paint session with options passed on first instantiation
    for (var option in options)
    {
      if (options.hasOwnProperty(option)) {
        this[option] = options[option];
      }  
    }
    
    // assign default values
    this.timestamp = this.store.getValue('session-timestamp', 0); 
    this.username = this.store.getValue('session-username', undefined); 
    
    this.renderLoginPanel();
    this.renderOpenId();
    this.evaluate();
  };
  $.extend(true, ClientSideUserSession.prototype, {
    
    /**
     * @cfg {Object} panel properties of the session-panel box with login/logout button
     * @cfg {Object.String} renderTo selector to a DOM node to which session-panel is to be appended. Default value: "body:first"
     * @cfg {Object.String} style style applied to panel. Default value is 'display: inline-block; position: absolute; top: 5px; left: 5px;'
     */
    panel: {
      renderTo: "body:first",
      style: 'display: inline-block; position: absolute; top: 5px; left: 5px;'
    },
    
    /**
     * @cfg {Object} language language strings used by this component
     * @cfg {Object.String} login 
     * @cfg {Object.String} logout
     * @cfg {Object.String} logoutMsgNoname
     * @cfg {Object.String} logoutMsg
     */
    language: {
      login: 'Sign in',
      logout: 'Log out',
      logoutMsgNoname: 'Log out',
      logoutMsg: 'Logged in as ${username}.<br/> Click here to log out.'
    },  
    
    /**
     * @cfg {Number} timeout session timeout in milliseconds
     */
    timeout: 180000,
  
    // private
    timestamp: 0,
    
    // private
    renderOpenId: function () {
      var openidStript;
      if (this.openid.provider === 'janrain') {
        // janrain should come with script and 
        // append janrain openid login script initCls
        
        $('#session-login-panel > a:first').addClass(this.openid.initCls);
  
        openidStript = document.createElement('script');
        openidStript.innerHTML = this.openid.script;
        document.getElementsByTagName('head')[0].appendChild(openidStript);
        
      }
    },
    
    // private
    renderLoginPanel: function () {
  
      var renderTo = $(this.panel.renderTo);
      if (!renderTo) {
        throw "Wrong session config: renderTo points to no known DOM nodes";
      }
      
      // TODO move html definition into a template object (to be overridden on demand)
      
      $(renderTo).append(
          '<div id="session-panel">' + 
            '<div id="session-login-panel">' +
              '<a class="session-login session-hidden session-only-unauthenticated" onclick="return false;" href="#">' + 
                this.language.login + 
              '</a>' +
            '</div>' + 
            '<div id="session-logout-panel">' +
              '<a class="session-logout session-hidden session-only-authenticated" onclick="return false;" href="">' + 
                this.language.logout + 
              '</a>' +
            '</div>' + 
          '</div>');
      
      $("#session-login-panel", renderTo).click($.proxy(function () {
        this.store.setValue('session-signin-location', document.location.href);
        this.store.setValue('session-signin-timestamp', this.timestamp);
      }, this));
      
      $("#session-logout-panel", renderTo).click($.proxy(function () {    
        this.ajax.getJson({
          params: {
            action: 'logout'
          },
          url: this.url,
          onSuccess: $.proxy(function () {
            this.reevaluate();
          }, this)  
        });
      }, this));
      $("head:first").append(
        '<style type="text/css">' +
          '#session-panel { ' + this.panel.style + '}' +
          '.session-hidden { display: none !important;}' +
        '</style>');
    },
    
    // private
    evaluate: function () {
      // First page loaded after session was created has an #auth tag. 
      // Session should be then flushed and requeried from server.
      if (document.location.href.match(/#auth$/)) {
        console.info("New session detected");
        // Flush session
        this.flushStore();
        // Load session from server
        this.loadFromServer();
      }
      else {
        console.debug("Session is not new");
        // An established session marks that in local store
        if (this.store.getValue('session-established', false) === true) {
          console.debug("Session data is available");
          // Session stored in local store expires after timeout
          if ((new Date()).getTime() - this.store.getValue('session-timestamp', 0) > this.timeout) {
            console.info("Session for user ${username} expired".replace("${username}", this.username));
            // Flush session
            this.flushStore();
            // Load session from server
            this.loadFromServer();
          }
          else {
            console.debug("Session for user ${username} has not expired yet".replace("${username}", this.username));
            // Load session from local store
            console.debug("Loading session from local store");
            this.timestamp = this.store.getValue('session-timestamp', 0);
            this.username = this.store.getValue('session-username', undefined);
            this.onEstablished(this);
            // Check again session status after 
            window.setTimeout($.proxy(this.evaluate, this), this.timeout);
          }
        }
        else {
          console.debug("Session data is not available, requery from server is required");
          // Load session from server
          this.loadFromServer();
        }
      }
    },
    
    // private
    flushStore: function () {
      console.debug('Flushing session data in local store');
      // note that we are not deleting values, to make APIs simpler
      this.store.setValue('session-timestamp', 0);
      this.store.setValue('session-locked', false);
      this.store.setValue('session-established', false);
      this.store.deleteValue('session-username');
    },
  
    // private
    loadFromServer: function () {
      //Is any other tab getting data from server?
      if (this.store.getValue('session-locked', false) === true) {
        console.debug("Server access is locked - session is being loaded from server in another tab");
        window.setTimeout($.proxy(this.evaluate, this), 100);
        return;
      }
      //Load session from server
      console.debug("Loading session from server");
      
      this.ajax.getJson({
        params: {
          action: 'ident'
        },
        url: this.url,
        /**
         * @param {Object} response
         */
        onSuccess : $.proxy(function (response) {
          console.debug("Session data was successfully received from server");
          var timestamp = (new Date()).getTime().toString();
          this.store.setValue('session-timestamp', timestamp);
          this.timestamp = timestamp;
          
          this.store.setValue('session-username', response.username);
          this.username = response.username;
          
          this.store.setValue('session-established', true);
          this.store.setValue('session-locked', false);
          
          this.onEstablished(this);
          window.setTimeout($.proxy(this.evaluate, this), this.timeout);
        }, this),
        /**
         * @param {Object} response
         */
        onFailure: $.proxy(function (response) {
          console.debug("Session was not loaded from server");
          this.username = undefined;
          var timestamp = new Date().getTime().toString();
          this.store.setValue('session-timestamp', timestamp);
          this.timestamp = timestamp;
          
          this.store.setValue('session-established', true);
          this.store.setValue('session-locked', false);
          
          this.onEstablished(this);
          window.setTimeout($.proxy(this.evaluate, this), this.timeout);
        }, this)
      });
    },
  
    /**
     * when session checks out
     * @param {ClientSideUserSession} session
     * @private
     */
    onEstablished: function (session) {
      if (session.username === undefined) {
        // authentication failure
        console.info("Unauthenticated browser tab");
        
        $(".session-logout").text(this.language.logoutMsgNoname); 
      }
      else {
        // authentication successful
        console.info("Authenticated as ${username}".replace('${username}', session.username));
        
        $(".session-logout").html(this.language.logoutMsg.replace('${username}', session.username));
        
        // sometimes sign in was not done from first page - then we need to go back to it.
        // it's stored in local store for that
        if (document.location.href.match(/#auth$/)) {
          if (
              ((new Date()).getTime() - this.store.getValue('session-signin-timestamp') < this.timeout) && 
              this.store.getValue('session-signin-location', false)
          ) {
            document.location.href = this.store.getValue('session-signin-location');
          }    
        }
      }
      this.toggleContext();
    },
    
    /**
     * Toggle all session-dependant html on or off
     */
    toggleContext: function () {
      if (this.username === undefined) {
        $(".session-only-authenticated").addClass('session-hidden');
        $(".session-only-unauthenticated").removeClass('session-hidden');
      }
      else {
        $(".session-only-unauthenticated").addClass('session-hidden');
        $(".session-only-authenticated").removeClass('session-hidden');
      }
    },
  
    /**
     * Forced check if session is stil valid 
     */
    reevaluate: function () {
      this.flushStore();
      this.evaluate();
    }
  });

  context.ClientSideUserSession = ClientSideUserSession;
})(this);