'use strict'

const co = require('co')
const assert = require('assert')
const compose = require('koa-compose')

module.exports = convert

function convert (mw) {
  if (typeof mw !== 'function') {
    throw new TypeError('middleware must be a function')
  }
  if (mw.constructor.name !== 'GeneratorFunction') {
    // assume it's Promise-based middleware
    return mw
  }
  const converted = function (ctx, next) {
    return co.call(ctx, mw.call(ctx, createGenerator(next)))
  }
  converted._name = mw._name || mw.name
  return converted
}

function * createGenerator (next) {
  return yield next()
}

// convert.compose(mw, mw, mw)
// convert.compose([mw, mw, mw])
convert.compose = function (arr) {
  if (!Array.isArray(arr)) {
    arr = Array.from(arguments)
  }
  return compose(arr.map(convert))
}

convert.back = function (mw) {
  if (typeof mw !== 'function') {
    throw new TypeError('middleware must be a function')
  }
  if (mw.constructor.name === 'GeneratorFunction') {
    // assume it's generator middleware
    return mw
  }
  const converted = function * (next) {
    let ctx = this
    let called = false
    // no need try...catch here, it's ok even `mw()` throw exception
    yield Promise.resolve(mw(ctx, function () {
      if (called) {
        // guard against multiple next() calls
        // https://github.com/koajs/compose/blob/4e3e96baf58b817d71bd44a8c0d78bb42623aa95/index.js#L36
        return Promise.reject(new Error('next() called multiple times'))
      }
      called = true
      return co.call(ctx, next)
    }))
  }
  converted._name = mw._name || mw.name
  return converted
}

convert.mount = mount

/**
 * Mount `app` with `prefix`, `app`
 * may be a Koa application or
 * middleware function.
 *
 * @param {String|Application|Function} prefix, app, or function
 * @param {Application|Function} [app or function]
 * @return {Function}
 * @api public
 */

function mount (prefix, app) {
  if (typeof prefix !== 'string') {
    app = prefix
    prefix = '/'
  }

  assert(prefix[0] === '/', 'mount path must begin with "/"')

  // compose
  var downstream = app.middleware
    ? compose(app.middleware)
    : app

  // don't need to do mounting here
  if (prefix === '/') return downstream

  var trailingSlash = prefix.slice(-1) === '/'

  return function (ctx, upstream) {
    var prev = ctx.path
    var newPath = match(prev)
    if (!newPath) return upstream()

    ctx.mountPath = prefix
    ctx.path = newPath

    return Promise.resolve(downstream(ctx, () => {
      ctx.path = prev
      return upstream().then(() => {
        ctx.path = newPath
      })
    })).then(() => {
      ctx.path = prev
    })
  }

  /**
   * Check if `prefix` satisfies a `path`.
   * Returns the new path.
   *
   * match('/images/', '/lkajsldkjf') => false
   * match('/images', '/images') => /
   * match('/images/', '/images') => false
   * match('/images/', '/images/asdf') => /asdf
   *
   * @param {String} prefix
   * @param {String} path
   * @return {String|Boolean}
   * @api private
   */

  function match (path) {
    // does not match prefix at all
    if (path.indexOf(prefix) !== 0) return false

    var newPath = path.replace(prefix, '') || '/'
    if (trailingSlash) return newPath

    // `/mount` does not match `/mountlkjalskjdf`
    if (newPath[0] !== '/') return false
    return newPath
  }
}
