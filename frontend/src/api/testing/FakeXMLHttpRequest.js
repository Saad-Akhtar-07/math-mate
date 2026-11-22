export default class FakeXMLHttpRequest {
  static instances = []
  static onSend = null
  constructor() {
    this.upload = {}
    this.headers = {}
    FakeXMLHttpRequest.instances.push(this)
  }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(name, value) { this.headers[name] = value }
  send(body) { this.body = body; FakeXMLHttpRequest.onSend?.(this) }
  progress(loaded, total, lengthComputable = true) { this.upload.onprogress?.({ loaded, total, lengthComputable }) }
  transferred() { this.upload.onload?.() }
  respond(status, response) { this.status = status; this.response = response; this.onload?.() }
  fail() { this.onerror?.() }
  expire() { this.ontimeout?.() }
  abort() { this.aborted = true; this.onabort?.() }
  static reset() { this.instances = []; this.onSend = null }
}
