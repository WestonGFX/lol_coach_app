function encodeSpecialCharacters(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16));
}
module.exports = { encodeSpecialCharacters };
