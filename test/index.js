var consul = require('consul')({promisify: true});
var config = require('../index');
var nock = require('nock');

var defaultHeaders = {
    'x-consul-index': '666',
    'x-consul-lastcontact': '10',
    'x-consul-knownleader': 'true',
    'x-consul-translate-addresses': 'true'
  };

var cfg = {
  value: config.value(),
  valueWithDefault: config.value({default: 123}),
  nested: {
    value: config.value()
  },
  db: {
    credentials: {
      username: config.value({default: 'rootato'})
    }
  }
}

describe('When an env var is present', function() {

  beforeEach(function() {
    process.env.VALUE = 'tomato'
  });

  it('should be set on the config', function () {
    var result = config.build(cfg)
    expect(result.value).toBe('tomato')
  });

  afterEach(function () { delete process.env.VALUE });
})

describe('When an env var is present for a nested key', function () {

  beforeEach(function() {
    process.env.NESTED_VALUE = 'potato'
  });

  it('should be set on the config', function () {
    var result = config.build(cfg)
    expect(result.nested.value).toBe('potato')
  });

  afterEach(function () { delete process.env.NESTED_VALUE });
});

describe('When a value has a default', function () {

  it('should be set on the config', function () {
    var result = config.build(cfg)
    expect(result.valueWithDefault).toBe(123)
  })

})

describe('When a defaulted value is set by environment variable', function () {

  beforeEach(function() {
    process.env.DB_CREDENTIALS_USERNAME = 'rootato'
  })

  it('should use the environment value', function () {
    var result = config.build(cfg)
    expect(result.db.credentials.username).toBe('rootato')
  })

  afterEach(function () { delete process.env.DB_CREDENTIALS_USERNAME });
})

describe('When a prefix is set', function () {

  beforeEach(function() {
    process.env.MYAPP_DB_CREDENTIALS_USERNAME = 'sausages'
  })

  it('should use the environment value', function () {
    var result = config.build(cfg, {envPrefix: 'myapp'})
    expect(result.db.credentials.username).toBe('sausages')
  })

  afterEach(function () { delete process.env.MYAPP_DB_CREDENTIALS_USERNAME });
})

describe('When a value is present in consul', function () {

  var consulCfg = {
    value: config.value()
  }

  it('should use the value from consul', function(done) {
    var result = config.build(consulCfg, {consulPrefix: 'myapp'})
    setTimeout(function() {
      expect(result.value).toBe('saussignac')
      done();
    }, 100);
  })
})

describe('When a service is defined by env vars', function () {

  var cfg = {
    db: config.service('12factorial-test')
  }

  var result = {};

  beforeEach(function() {
    process.env.DB_ADDRESS = '10.128.64.32'
    process.env.DB_PORT = 5432
  })

  it('should be able to return the address', function () {
    var result = config.build(cfg)
    expect(result.db.getAddress()).toBe('10.128.64.32:5432')
  })

  it('should be able to return the port', function () {
    var result = config.build(cfg)
    expect(result.db.port).toBe(5432)
  })

  it('should be able to return the address', function () {
    var result = config.build(cfg)
    expect(result.db.address).toBe('10.128.64.32')
  })

  it('should be able to build a uri', function () {
    var result = config.build(cfg)
    expect(result.db.buildUri('foo')).toBe('10.128.64.32:5432/foo')
  })

  afterEach(function () {
    delete process.env.DB_ADDRESS;
    delete process.env.DB_PORT;
  });
})

describe('When a service is present in consul', function () {

  var cfg = {
    db: config.service('12factorial-test')
  }

  var result;

  beforeEach(function (done) {
    consul.agent.service.register({
      id: "12factorial-test",
      name: "12factorial-test",
      address: "10.128.64.32",
      port: 1234
    }).then(function() {
      result = config.build(cfg);
      setTimeout(function() {
        done();
      }, 100);
    });
  });

   it('should be able to return the address', function () {
    expect(result.db.getAddress()).toBe('10.128.64.32:1234')
  })

  it('should be able to return the port', function () {
    expect(result.db.port).toBe(1234)
  })

  it('should be able to return the address', function () {
    expect(result.db.address).toBe('10.128.64.32')
  })

  it('should be able to build a uri', function () {
    expect(result.db.buildUri('foo')).toBe('10.128.64.32:1234/foo')
  })


})
