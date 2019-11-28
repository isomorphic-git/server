var fs = require('fs')
var fp = require('fs').promises
var path = require('path')
var url = require('url')
var { serveInfoRefs, serveReceivePack } = require('isomorphic-git/dist/for-node/isomorphic-git/internal-apis.js')

var chalk = require('chalk')
var is = require('./identify-request.js')
var parse = require('./parse-request.js')

function pad (str) {
  return (str + '    ').slice(0, 7)
}

function log(req, res) {
  const color = res.statusCode > 399 ? chalk.red : chalk.green
  console.log(color(`[git-server] ${res.statusCode} ${pad(req.method)} ${req.url}`))
  return false
}

function factory (config) {
  return async function middleware (req, res, next) {
    const u = url.parse(req.url, true)
    if (!next) next = () => void(0)

    if (is.preflightInfoRefs(req, u)) {
      res.statusCode = 204
      res.end('')
    } else if (is.preflightPull(req, u)) {
      res.statusCode = 204
      res.end('')
    } else if (is.preflightPush(req, u)) {
      res.statusCode = 204
      res.end('')
    } else if (is.infoRefs(req, u)) {
      let { gitdir, service } = parse.infoRefs(req, u)
      gitdir = path.join(__dirname, gitdir)
      const { headers, response } = await serveInfoRefs({ fs, gitdir, service })
      for (const header in headers) {
        res.setHeader(header, headers[header])
      }
      res.statusCode = 200
      for (const buffer of response) {
        res.write(buffer)
      }
      res.end()
    } else if (is.pull(req, u)) {
      const { gitdir } = parse.pull(req, u)
      res.statusCode = 500
      res.end('Unsupported operation\n')
    } else if (is.push(req, u)) {
      const { gitdir, service } = parse.push(req, u)
      req.pipe(process.stdout)
      const { headers, response } = await serveReceivePack({ fs, gitdir, service, banner: require('./logo.js') })
      for (const header in headers) {
        res.setHeader(header, headers[header])
      }
      res.statusCode = 200
      for (const buffer of response) {
        res.write(buffer)
      }
      res.end('')
    }
    log(req, res)
  }
}

module.exports = factory
