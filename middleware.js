var fs = require('fs')
var fp = require('fs').promises
var path = require('path')
var url = require('url')
var { indexPack } = require('isomorphic-git')
var { serveInfoRefs, serveReceivePack, parseReceivePackRequest } = require('isomorphic-git/dist/for-node/isomorphic-git/internal-apis.js')

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
      let { gitdir, service } = parse.push(req, u)
      let { capabilities, updates, packfile } = await parseReceivePackRequest(req)
      const dir = await fp.mkdtemp(path.join(__dirname, 'quarantine', gitdir + '-'))
      let filepath = 'pack-.pack'
      const stream = fs.createWriteStream(path.join(dir, filepath))
      let last20
      for await (const buffer of packfile) {
        if (buffer) {
          last20 = buffer.slice(-20)
          stream.write(buffer)
        }
      }
      stream.end()
      if (last20 && last20.length === 20) {
        last20 = last20.toString('hex')
        const oldfilepath = filepath
        filepath = `pack-${last20}.pack`
        await fp.rename(path.join(dir, oldfilepath), path.join(dir, filepath))
      }
      // index packfile
      gitdir = path.join(__dirname, gitdir)
      await indexPack({ fs, gitdir, dir, filepath })
      const { headers, response } = await serveReceivePack({ fs, gitdir, service, banner: require('./logo.js'), ok: updates.map(x => x.fullRef) })
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
