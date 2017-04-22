var consul = require ('consul')({ promisify: true })

function _Value(opts) {
  this.opts = opts;

  this.apply = function (path, key, target, builderOpts) {
    var varname = path.concat([key]);
    if (builderOpts.envPrefix) {
      varname.unshift(builderOpts.envPrefix);
    }
    var envValue = process.env[(varname.join('_')).toUpperCase()];

    if (envValue !== undefined) {
      target[key] = envValue;
    } else if (builderOpts.consulPrefix) {
        this.applyConsulWatch(path, key, target, builderOpts);
    } else {
      target[key] = this.opts.default;
    }
  }

  this.applyConsulWatch = function (path, key, target, builderOpts) {
    var keyPath = [builderOpts.consulPrefix].concat(path).concat([key]).join('/');
    var watch = consul.watch({ method: consul.kv.get, options: { key: keyPath }});
    var _default = this.opts.default;
    watch.on('change', function(data, res) {
      if (res.statusCode == 200 && data && data.Value) {
        target[key] = data.Value;
      } else {
        target[key] = _default;
      }
    })
  }
}

function _Service (name, opts) {
  this.opts = opts;
  this.service = name;

  this.apply = function (path, key, target, builderOpts) {
    var addrVar = path.concat([key, 'ADDRESS'])
    var portVar = path.concat([key, 'PORT'])

    if (builderOpts.envPrefix) {
      addrVar.unshift(builderOpts.envPrefix)
      portVar.unshift(builderOpts.envPrefix)
    }

    addrVar = process.env[addrVar.join('_').toUpperCase()]
    portVar = parseInt(process.env[portVar.join('_').toUpperCase()])

    if (addrVar !== undefined && portVar !== undefined) {
      target[key] = new _ServiceValue(addrVar, portVar)
    } else {
       this.applyConsulWatch(path, key, target, builderOpts)
    }
  }

  this.applyConsulWatch = function (path, key, target, builderOpts) {
    var keyPath = [builderOpts.consulPrefix].concat(path).concat([key]).join('/');
    var watch = consul.watch({ method: consul.catalog.service.nodes, options: { service: this.service }});
    var _default = this.opts.default;
    watch.on('change', function(data, res) {
      if (res.statusCode == 200 && data) {
        var item = data[Math.floor(Math.random()*data.length)]
        target[key] = new _ServiceValue(item.ServiceAddress, item.ServicePort)
      } else {
        target[key] = _default;
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

function _buildRecursive (spec, opts, path) {
  var target = {};

  for(var key in spec){
    var val = spec[key]
    if (val instanceof _Value) {
      val.apply(path, key, target, opts);
    } else if (val instanceof _Service) {
      val.apply(path, key, target, opts);
    } else  if (_isObject(val)) {
      target[key] = _buildRecursive(spec[key], opts, path.concat([key]));
    }
  }
  return target;
}

module.exports.build = function (spec, opts){
  return _buildRecursive(spec, opts || {}, []);
}

module.exports.value = function (opts){
  return new _Value(opts || {});
}

module.exports.service = function (name, opts) {
  return new _Service(name, (opts || {}));
}
