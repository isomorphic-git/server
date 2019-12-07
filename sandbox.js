const fs = require('fs')
const EventEmitter = require('events').EventEmitter

const { VM, VMScript } = require('vm2');
const git = require('isomorphic-git')
const { pgp } = require('@isomorphic-git/pgp-plugin')

const { lookup, demote } = require('./lookup.js')

const curry = ({ core, dir, gitdir }) => fn => argObject => fn({ ...argObject, core, dir, gitdir })

const sandbox = ({ name, core, dir, gitdir, res, oids, updates, script }) => {
  let ee = new EventEmitter()
  plugincore = git.cores.create(core)
  plugincore.set('emitter', ee)
  plugincore.set('fs', fs)
  plugincore.set('pgp', pgp)

  const $ = curry({ core, dir, gitdir })
  const $git = {
    E: { ...git.E },
    eventEmitter: ee,
    expandOid: $(git.expandOid),
    expandRef: $(git.expandRef),
    findMergeBase: $(git.findMergeBase),
    getRemoteInfo: $(git.getRemoteInfo),
    hashBlob: $(git.hashBlob),
    isDescendent: $(git.isDescendent),
    listBranches: $(git.listBranches),
    listFiles: $(git.listFiles),
    listRemotes: $(git.listRemotes),
    listTags: $(git.listTags),
    log: $(git.log),
    readObject: $(git.readObject),
    resolveRef: $(git.resolveRef),
    serveReceivePack: $(git.serveReceivePack),
    verify: $(git.verify),
    walkBeta2: $(git.walkBeta2),
  }
  const $res = {
    write: res.write.bind(res)
  }

  return new Promise((resolve, reject) => {
    const $console = {
      log: async (...args) => {
        res.write(await git.serveReceivePack({ type: 'print', message: args.join() }))
      },
      error: (...args) => {
        reject(new Error(args.join()))
      }
    }
    const vm = new VM({
      timeout: 10000,
      eval: false,
      wasm: false,
      sandbox: {
        updates,
        oids,
        git: $git,
        pgp: { lookup, demote },
        done: (err) => err ? reject(err) : resolve(),
        console: $console,
      }
    });
    try {
      script = new VMScript(script, name).compile();
    } catch (err) {
      reject(err);
    }
    try {
      vm.run(script);
    } catch (e) {
      reject(e);
    }
  })

}

module.exports = {
  sandbox
}
// console.log(runVM({ core: 'default', dir: '', gitdir: '', script: `String(Object.keys(git))` }))
