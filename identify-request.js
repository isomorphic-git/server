function preflightInfoRefs (req, u) {
  return req.method === 'OPTIONS' && u.pathname.endsWith('/info/refs') && (u.query.service === 'git-upload-pack' || u.query.service === 'git-receive-pack')
}

function infoRefs (req, u) {
  return req.method === 'GET' && u.pathname.endsWith('/info/refs') && (u.query.service === 'git-upload-pack' || u.query.service === 'git-receive-pack')
}

function preflightPull (req, u) {
  return req.method === 'OPTIONS' && req.headers['access-control-request-headers'].includes('content-type') && u.pathname.endsWith('git-upload-pack')
}

function pull (req, u) {
  return req.method === 'POST' && req.headers['content-type'] === 'application/x-git-upload-pack-request' && u.pathname.endsWith('git-upload-pack')
}

function preflightPush (req, u) {
  return req.method === 'OPTIONS' && req.headers['access-control-request-headers'].includes('content-type') && u.pathname.endsWith('git-receive-pack')
}

function push (req, u) {
  return req.method === 'POST' && req.headers['content-type'] === 'application/x-git-receive-pack-request' && u.pathname.endsWith('git-receive-pack')
}

module.exports = {
  preflightInfoRefs,
  infoRefs,
  preflightPull,
  pull,
  preflightPush,
  push
}
