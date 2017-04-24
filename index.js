var consul = require ('consul');
var events = require('events');

var _defaultLogger = {
  debug: function(m) { console.log("12factor@debug: " +m); },
  info: function(m) { console.log("12factor@info: " +m); },
  warn: function(m) { console.log("12factor@warn: " +m); },
  error: function(m) { console.log("12factor@error: " +m); },
}

function _Value(opts) {
  this.opts = opts;

  this.apply = function (client, path, key, target, builderOpts) {
    var varname = path.concat([key]);
    var prefixed = path.concat([key]);
    varname = varname.join('.');

    if (! this.opts.optional) {
      builderOpts.required[varname] = true;
    }

    if (builderOpts.envPrefix) {
      prefixed.unshift(builderOpts.envPrefix);
    }

    var envValue = process.env[(prefixed.join('_')).toUpperCase()];

    if (envValue !== undefined) {
      target[key] = envValue;
      builderOpts.emitter.emit('change', varname, envValue, undefined);
    } else if (builderOpts.consulPrefix && builderOpts.enableconsul) {
        this.applyConsulWatch(client, path, key, target, builderOpts);
    } else {
      target[key] = this.opts.default;
      builderOpts.emitter.emit('change', varname, opts.default, undefined);
    }
  }

  this.applyConsulWatch = function (client, path, key, target, builderOpts) {
    var varname = path.concat([key]).join('.');
    var keyPath = [builderOpts.consulPrefix].concat(path).concat([key]).join('/');
    var watch = client.watch({ method: client.kv.get, options: { key: keyPath }});
    var _default = this.opts.default;
    watch.on('change', function(data, res) {
      var prev = target[key];
      if (res.statusCode == 200 && data && data.Value) {
        target[key] = data.Value;
        builderOpts.emitter.emit('change', varname, data.Value, prev);
      } else {
        target[key] = _default;
        builderOpts.emitter.emit('change', varname, _default, prev);
      }
    })
  }
}

function _Service (name, opts) {
  this.opts = opts;
  this.service = name;

  this.apply = function (client, path, key, target, builderOpts) {
    var addrVar = path.concat([key, 'ADDRESS'])
    var portVar = path.concat([key, 'PORT'])
    var varname = path.concat([key]).join('.');

    if (! this.opts.optional) {
      builderOpts.required[varname] = true;
    }

    if (builderOpts.envPrefix) {
      addrVar.unshift(builderOpts.envPrefix)
      portVar.unshift(builderOpts.envPrefix)
    }

    addrVar = process.env[addrVar.join('_').toUpperCase()]
    portVar = parseInt(process.env[portVar.join('_').toUpperCase()])

    if (addrVar !== undefined && portVar !== undefined) {
      target[key] = new _ServiceValue(addrVar, portVar)
      builderOpts.emitter.emit('change', varname, target[key], undefined);
    } else if(builderOpts.enableconsul) {
       this.applyConsulWatch(client, path, key, target, builderOpts)
    }
  }

  this.applyConsulWatch = function (client, path, key, target, builderOpts) {
    var varname = path.concat([key]).join('.');
    var keyPath = [builderOpts.consulPrefix].concat(path).concat([key]).join('/');
    var watch = client.watch({ method: client.catalog.service.nodes, options: { service: this.service }});
    var _default = this.opts.default;
    watch.on('change', function(data, res) {

      var prev = target[key];
      if (res.statusCode == 200 && data) {
        var item = data[Math.floor(Math.random()*data.length)]
        target[key] = new _ServiceValue(item.ServiceAddress, item.ServicePort)
        builderOpts.emitter.emit('change', varname, item, prev);
      } else {
        target[key] = _default;
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

function _buildRecursive (client, target, spec, opts, path) {
  for(var key in spec){
    var val = spec[key]
    if (val instanceof _Value) {
      val.apply(client, path, key, target, opts);
    } else if (val instanceof _Service) {
      val.apply(client, path, key, target, opts);
    } else  if (_isObject(val)) {
      target[key] = _buildRecursive(client, {}, spec[key], opts, path.concat([key]));
    } else {
      target[key] = val;
    }
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
        opts.emitter.on('change', changeHandler(target, resolve, reject));
        _buildRecursive(client, target, spec, opts || {}, []);
      });
    });
}

module.exports.value = function (opts){
  return new _Value(opts || {});
}

module.exports.service = function (name, opts) {
  return new _Service(name, (opts || {}));
}
