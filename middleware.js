const fs = require('fs')
const fp = require('fs').promises
const path = require('path')
const url = require('url')
const EventEmitter = require('events').EventEmitter
const { E, indexPack, plugins, readObject, resolveRef, serveInfoRefs, serveReceivePack, parseReceivePackRequest } = require('isomorphic-git')
const { pgp } = require('@isomorphic-git/pgp-plugin')

let ee = new EventEmitter()
plugins.set('emitter', ee)
plugins.set('fs', fs)
plugins.set('pgp', pgp)

const chalk = require('chalk')
const is = require('./identify-request.js')
const parse = require('./parse-request.js')
const { lookup, demote } = require('./lookup.js')
const { sandbox } = require('./sandbox.js')

function pad (str) {
  return (str + '    ').slice(0, 7)
}

function abbr (oid) {
  return oid.slice(0, 7)
}

const sleep = ms => new Promise(cb => setTimeout(cb, ms))

const tick = () => new Promise(cb => process.nextTick(cb))

function logIncoming(req, res) {
  const color = res.statusCode > 399 ? chalk.red : chalk.green
  console.log(`    ${pad(req.method)} ${req.url}`)
  return false
}

function logOutgoing(req, res) {
  const color = res.statusCode > 399 ? chalk.red : chalk.green
  console.log(color(`${res.statusCode} ${pad(req.method)} ${req.url}`))
  return false
}

function factory (config) {
  return async function middleware (req, res, next) {
    const u = url.parse(req.url, true)
    if (!next) next = () => void(0)

    logIncoming(req, res)

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
      try {
        let { capabilities, updates, packfile } = await parseReceivePackRequest(req)

        // Save packfile to quarantine folder
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
        const core = gitdir + '-' + String(Math.random()).slice(2, 8)
        gitdir = path.join(__dirname, gitdir)

        // send HTTP response headers
        const { headers } = await serveReceivePack({ type: 'service', service })
        res.writeHead(200, headers)

        // index packfile
        res.write(await serveReceivePack({ type: 'print', message: 'Indexing packfile...' }))
        await tick()
        let currentPhase = null
        const listener = async ({ phase, loaded, total, lengthComputable }) => {
          let np = phase !== currentPhase ? '\n' : '\r'
          currentPhase = phase
          res.write(await serveReceivePack({ type: 'print', message: `${np}${phase} ${loaded}/${total}` }))
        }
        let oids
        try {
          ee.on(`${last20}:progress`, listener)
          oids = await indexPack({ fs, gitdir, dir, filepath, emitterPrefix: `${last20}:` })
          await tick()
          res.write(await serveReceivePack({ type: 'print', message: '\nIndexing completed' }))
          res.write(await serveReceivePack({ type: 'unpack', unpack: 'ok' }))
        } catch (e) {
          res.write(await serveReceivePack({ type: 'print', message: '\nOh dear!' }))
          res.write(await serveReceivePack({ type: 'unpack', unpack: e.message }))

          for (const update of updates) {
            res.write(await serveReceivePack({ type: 'ng', ref: update.fullRef, message: 'Could not index pack' }))
          }
          throw e
        } finally {
          ee.removeListener(`${last20}:progress`, listener)
        }
        await tick()

        // Move packfile and index into repo
        await fp.rename(path.join(dir, filepath), path.join(gitdir, 'objects', 'pack', filepath))
        await fp.rename(path.join(dir, filepath.replace(/\.pack$/, '.idx')), path.join(gitdir, 'objects', 'pack', filepath.replace(/\.pack$/, '.idx')))
        await fp.rmdir(path.join(dir))

        // Run pre-receive-hook
        res.write(await serveReceivePack({ type: 'print', message: '\nRunning pre-receive hook\n' }))
        await tick()
        let script
        try {
          const oid = await resolveRef({ gitdir, ref: 'HEAD' })
          const { object } = await readObject({ gitdir, oid, filepath: '.hooks/pre-receive.js', encoding: 'utf8' })
          script = object
        } catch (e) {
          console.log(e)
          script = fs.readFileSync('./pre-receive-hook.js', 'utf8')
        }
        await sandbox({ name: 'pre-receive.js', core, dir, gitdir, res, oids, updates, script })

        // refs
        for (const update of updates) {
          res.write(await serveReceivePack({ type: 'ok', ref: update.fullRef }))
        }

        // gratuitous banner
        res.write(await serveReceivePack({ type: 'print', message: '\n' + require('./logo.js') }))
      } catch (e) {
        if (e.message === 'Client is done') {
          res.statusCode = 200
        } else {
          res.write(await serveReceivePack({ type: 'error', message: `${e.message}\n${e.stack}` }))
        }
      } finally {
        // fin
        res.write(await serveReceivePack({ type: 'fin' }))
        res.end('')
      }
    }

    logOutgoing(req, res)
  }
}

module.exports = factory
