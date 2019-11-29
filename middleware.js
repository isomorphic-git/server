const fs = require('fs')
const fp = require('fs').promises
const path = require('path')
const url = require('url')
const EventEmitter = require('events').EventEmitter
const { indexPack, plugins, readObject, verify } = require('isomorphic-git')
const { serveInfoRefs, serveReceivePack, parseReceivePackRequest } = require('isomorphic-git/dist/for-node/isomorphic-git/internal-apis.js')
const { pgp } = require('@isomorphic-git/pgp-plugin')

let ee = new EventEmitter()
plugins.set('emitter', ee)
plugins.set('fs', fs)
plugins.set('pgp', pgp)

const chalk = require('chalk')
const is = require('./identify-request.js')
const parse = require('./parse-request.js')
const { lookup, demote } = require('./lookup.js')

function pad (str) {
  return (str + '    ').slice(0, 7)
}

const sleep = ms => new Promise(cb => setTimeout(cb, ms))

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
        gitdir = path.join(__dirname, gitdir)

        // send HTTP response headers
        const { headers } = await serveReceivePack({ type: 'service', service })
        for (const header in headers) {
          res.setHeader(header, headers[header])
        }
        res.statusCode = 200

        // index packfile
        res.write(await serveReceivePack({ type: 'print', message: 'Indexing packfile...' }))
        let currentPhase = null
        const listener = async ({ phase, loaded, total, lengthComputable }) => {
          let np = phase !== currentPhase ? '\n' : '\r'
          currentPhase = phase
          res.write(await serveReceivePack({ type: 'print', message: `${np}${phase} ${loaded}/${total}` }))
        }
        let problem = false
        let oids
        try {
          ee.on(`${last20}:progress`, listener)
          oids = await indexPack({ fs, gitdir, dir, filepath, emitterPrefix: `${last20}:` })
          res.write(await serveReceivePack({ type: 'print', message: '\nIndexing a success!' }))
          res.write(await serveReceivePack({ type: 'unpack', unpack: 'ok' }))
        } catch (e) {
          problem = true
          res.write(await serveReceivePack({ type: 'print', message: '\nOh dear!' }))
          res.write(await serveReceivePack({ type: 'unpack', unpack: e.message }))
        } finally {
          ee.removeListener(`${last20}:progress`, listener)
        }

        // Move packfile and index into repo
        await fp.rename(path.join(dir, filepath), path.join(gitdir, 'objects', 'pack', filepath))
        await fp.rename(path.join(dir, filepath.replace(/\.pack$/, '.idx')), path.join(gitdir, 'objects', 'pack', filepath.replace(/\.pack$/, '.idx')))

        // Verify objects (ideally we'd do this _before_ moving it into the repo... but I think we'd need a custom 'fs' implementation with overlays)
        res.write(await serveReceivePack({ type: 'print', message: '\nVerifying objects...\n' }))
        let i = 0

        for (const oid of oids) {
          i++
          res.write(await serveReceivePack({ type: 'print', message: `\rVerifying object ${i}/${oids.length}` }))
          const { type, object } = await readObject({ gitdir, oid })
          if (type === 'commit' || type === 'tag') {
            const email = type === 'commit' ? object.author.email : object.tagger.email
            res.write(await serveReceivePack({ type: 'print', message: `\nVerifying ${type} ${oid} by ${email}\n` }))
            const keys = await lookup(email)
            let ok = false
            for (const key of keys) {
              const result = await verify({ gitdir, ref: oid, publicKeys: key })
              if (result === false) {
                demote(email, key)
              } else {
                res.write(await serveReceivePack({ type: 'print', message: `\nSigned by ${result[0]}\n` }))
                ok = true
                break
              }
            }
            if (!ok) {
              res.write(await serveReceivePack({ type: 'error', message: `\nNo valid signature for ${type} ${oid}\n` }))
              throw new Error('NO SIGNATURE')
            }
          }
          // await sleep(1)
        }

        // refs
        for (const update of updates) {
          if (!problem) {
            res.write(await serveReceivePack({ type: 'ok', ref: update.fullRef }))
          } else {
            res.write(await serveReceivePack({ type: 'ng', ref: update.fullRef, message: 'Could not index pack' }))
          }
        }

        // gratuitous banner
        res.write(await serveReceivePack({ type: 'print', message: '\n' + require('./logo.js') }))
      } catch (e) {
        if (e.message === 'Client is done') {
          res.statusCode = 200
        } else {
          console.log(e)
          res.statusCode = 500
        }
      } finally {
        // fin
        res.write(await serveReceivePack({ type: 'fin' }))
        res.end('')
      }
    }
    log(req, res)
  }
}

module.exports = factory
