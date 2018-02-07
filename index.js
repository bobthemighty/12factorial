var consul = require ('consul');
var events = require('events');

var _defaultLogger = {
  debug: function(m) { console.log("12factor@debug: " +m); },
  info: function(m) { console.log("12factor@info: " +m); },
  warn: function(m) { console.log("12factor@warn: " +m); },
  error: function(m) { console.log("12factor@error: " +m); },
}

function id (x) { return x }

function readBool (x) {
  if(typeof x == "string" && x.toLowerCase() == "false") {
    return false;
  }

  return !!x;
}

var readerOf = function (value) {

  switch(typeof value) {
    case 'number':
      return parseInt;
    case 'boolean':
      return readBool
  }
  return id
}

function _Value(opts) {

  this.opts = opts;
  opts.reader = opts.reader || readerOf(this.opts.default)

  this.apply = function (client, path, key, target, builderOpts) {

    var varname = path.concat([key]).join('.');
    if (! this.opts.optional) {
      builderOpts.required[varname] = true;
    }

    var prefixed = path.concat([key]);
    if (builderOpts.envPrefix) {
      prefixed.unshift(builderOpts.envPrefix);
    }
    prefixed = prefixed.join('_').toUpperCase();

    var envValue = process.env[prefixed];

    if (envValue !== undefined) {
      if (this.opts.sensitive) {
        builderOpts.log.info("Setting " + varname + " to env var " + prefixed);
      } else {
        builderOpts.log.info("Setting " + varname + " to " +envValue + " from env var " + prefixed);
      }
      target[key] = opts.reader(envValue);
      builderOpts.emitter.emit('change', varname, envValue, undefined);
    } else if (builderOpts.consul.prefix && builderOpts.enableconsul) {
        this.applyConsulWatch(client, path, key, target, builderOpts);
    } else {
      if (this.opts.sensitive) {
        builderOpts.log.info("Setting " + varname + " to default value");
      } else {
         builderOpts.log.info("Setting " + varname + " to default value '" + opts.default+"'");
      }
      target[key] = this.opts.default;
      builderOpts.emitter.emit('change', varname, opts.default, undefined);
    }
  }

  this.applyConsulWatch = function (client, path, key, target, builderOpts) {
    var varname = path.concat([key]).join('.');
    var keyPath = [builderOpts.consul.prefix].concat(path).concat([key]).join('/');
    var watch = client.watch({ method: client.kv.get, options: { key: keyPath }});
    var _default = this.opts.default;
    var _sensitive = this.opts.sensitive;
    var _reader = this.opts.reader;
    watch.on('change', function(data, res) {
      var prev = target[key];
      if (res.statusCode == 200 && data && data.Value) {
        if (_sensitive) {
          builderOpts.log.info("Setting " + varname + " to consul kv " + keyPath + "@"+data.ModifyIndex);
        } else {
          builderOpts.log.info("Setting " + varname + " to " + data.Value + " from consul kv " + keyPath + '@'+data.ModifyIndex);
        }
        target[key] = _reader(data.Value);
        builderOpts.emitter.emit('change', varname, data.Value, prev);
      } else {
        builderOpts.log.warn("Received status code " + res.statusCode +", data= " + data + " for kv " +keyPath+ ". Falling back to default value '"+_default+"'");
        target[key] = _default;
        builderOpts.emitter.emit('change', varname, _default, prev);
      }
    })
  }
}

function _Service (name, opts) {
  this.opts = opts;
  this.service = name;

  this.extend = function(o) {
    this.extensions = o;
    return this;
  }

  this.apply = function (client, path, key, target, builderOpts) {
    var addrVarname = path.concat([key, 'ADDRESS'])
    var portVarname = path.concat([key, 'PORT'])
    var varname = path.concat([key]).join('.');

    if (! this.opts.optional) {
      builderOpts.required[varname] = true;
    }

    if (builderOpts.envPrefix) {
      addrVarname.unshift(builderOpts.envPrefix)
      portVarname.unshift(builderOpts.envPrefix)
    }

    addrVarname = addrVarname.join('_').toUpperCase();
    portVarname = portVarname.join('_').toUpperCase();

    addrVar = process.env[addrVarname]
    portVar = parseInt(process.env[portVarname])

    if (addrVar !== undefined && portVar !== undefined) {
      builderOpts.log.info("Setting service " + this.service + " to "+ addrVar +":" + portVar + " from env vars " + addrVarname +", "+portVarname);
      target[key] = new _ServiceValue(addrVar, portVar)
      builderOpts.emitter.emit('change', varname, target[key], undefined);
    } else if(builderOpts.enableconsul) {
       this.applyConsulWatch(client, path, key, target, builderOpts)
    }
  }

  this.applyConsulWatch = function (client, path, key, target, builderOpts) {
    var varname = path.concat([key]).join('.');
    var watch = client.watch({ method: client.catalog.service.nodes, options: { service: this.service }});
    var _default = this.opts.default;
    var _service = this.service;
    watch.on('change', function(data, res) {
      var prev = target[key];
      if (res.statusCode == 200 && data.length) {
        var item = data[Math.floor(Math.random()*data.length)]
        Object.assign(target[key], new _ServiceValue(item.ServiceAddress || item.Address, item.ServicePort));
        builderOpts.emitter.emit('change', varname, item, prev);
      } else {
        builderOpts.log.warn('No data returned from consul for service '+_service);
        target[key] = _default;
        if (_default !== undefined)
          builderOpts.emitter.emit('change', varname, _default, prev);
      }
    })
  }
}

function _ServiceValue (address, port) {

  this.port = port
  this.address = address

  this.getAddress = function () {
    return this.address + ':' + this.port
  }

  this.buildUri = function (path) {
    return this.getAddress() + '/' + path
  }
}

function _isObject(o) {
  if(!o) return false;
  if(Array.isArray(o)) return false;
  if(o.constructor != Object) return false;
  return true;
}

function _buildRecursive (client, target, spec, opts, path, watches, is_top) {
  for(var key in spec){
    var val = spec[key]
    if (val instanceof _Value) {
      val.apply(client, path, key, target, opts);
    } else if (val instanceof _Service) {
      target[key] = {};
      val.apply(client, path, key, target, opts);
      if (val.extensions) {
        _buildRecursive(client, target[key], val.extensions, opts, path.concat([key]), watches, false);
      }
    } else  if (_isObject(val)) {
      target[key] = _buildRecursive(client, {}, spec[key], opts, path.concat([key]), watches, false);
    } else {
      target[key] = val;
    }
  }
  if (is_top) {
    target.__watches = watches
  }
  return target;
}

module.exports.build = function (spec, opts){
  if (opts === undefined) { opts = {}; }
  if (!opts.consul) { opts.consul = {}; }
  if (!opts.log) { opts.log = _defaultLogger; }

  opts.consul.promisify = true;
  opts.emitter = new events.EventEmitter();
  opts.required = {};

  function changeHandler (target, resolve, reject) {
    var _handle  = function (name , v, old) {
      opts.required[name] = false;
      var hasMissing = false;

      for (var val in opts.required) {
        hasMissing |= opts.required[val];
      }
      if(! hasMissing) {
        resolve(target)
      }
    }
    return _handle
  }

  var client = consul(opts.consul);

  return client.agent.self()
    .then(function (data) {
      opts.log.info("Connected to consul node "+data.Config.NodeName);
      opts.enableconsul = true;
    }).catch(function (e) {
      opts.log.warn("Failed to connect to consul at "+opts.consul.host, e);
      opts.enableconsul = false;
    }).then(function() {
      return new Promise(function(resolve, reject) {
        var target = {};
        var watches = [];
        opts.emitter.on('change', changeHandler(target, resolve, reject));
        _buildRecursive(client, target, spec, opts || {}, [], watches, true);
      });
    });
}

module.exports.value = function (opts){
  return new _Value(opts || {});
}

module.exports.service = function (name, opts) {
  return new _Service(name, (opts || {}));
}

module.exports.close = function(cfg) {
  for (var watch in cfg.__watches) {
    watch.end()
  }
}
