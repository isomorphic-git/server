function infoRefs (req, u) {
  const gitdir = u.pathname.replace(/\/info\/refs$/, '').replace(/^\//, '')
  return { gitdir, service: u.query.service }
}

function pull (req, u) {
  const gitdir = u.pathname.replace(/\/git-upload-pack$/, '').replace(/^\//, '')
  return { gitdir, service: 'git-receive-pack' }
}

function push (req, u) {
  const gitdir = u.pathname.replace(/\/git-receive-pack$/, '').replace(/^\//, '')
  return { gitdir, service: 'git-receive-pack' }
}

module.exports = {
  infoRefs,
  pull,
  push
}
