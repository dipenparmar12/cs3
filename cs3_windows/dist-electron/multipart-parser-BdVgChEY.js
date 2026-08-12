import { r as e, t } from "./from-C0qC1AxI.js";
//#region node_modules/node-fetch/src/utils/multipart-parser.js
var n = 0, r = {
	START_BOUNDARY: n++,
	HEADER_FIELD_START: n++,
	HEADER_FIELD: n++,
	HEADER_VALUE_START: n++,
	HEADER_VALUE: n++,
	HEADER_VALUE_ALMOST_DONE: n++,
	HEADERS_ALMOST_DONE: n++,
	PART_DATA_START: n++,
	PART_DATA: n++,
	END: n++
}, i = 1, a = {
	PART_BOUNDARY: i,
	LAST_BOUNDARY: i *= 2
}, o = 10, s = 13, c = 32, l = 45, u = 58, d = 97, f = 122, p = (e) => e | 32, m = () => {}, h = class {
	constructor(e) {
		this.index = 0, this.flags = 0, this.onHeaderEnd = m, this.onHeaderField = m, this.onHeadersEnd = m, this.onHeaderValue = m, this.onPartBegin = m, this.onPartData = m, this.onPartEnd = m, this.boundaryChars = {}, e = "\r\n--" + e;
		let t = new Uint8Array(e.length);
		for (let n = 0; n < e.length; n++) t[n] = e.charCodeAt(n), this.boundaryChars[t[n]] = !0;
		this.boundary = t, this.lookbehind = new Uint8Array(this.boundary.length + 8), this.state = r.START_BOUNDARY;
	}
	write(e) {
		let t = 0, n = e.length, i = this.index, { lookbehind: m, boundary: h, boundaryChars: g, index: _, state: v, flags: y } = this, b = this.boundary.length, x = b - 1, S = e.length, C, w, T = (e) => {
			this[e + "Mark"] = t;
		}, E = (e) => {
			delete this[e + "Mark"];
		}, D = (e, t, n, r) => {
			(t === void 0 || t !== n) && this[e](r && r.subarray(t, n));
		}, O = (n, r) => {
			let i = n + "Mark";
			i in this && (r ? (D(n, this[i], t, e), delete this[i]) : (D(n, this[i], e.length, e), this[i] = 0));
		};
		for (t = 0; t < n; t++) switch (C = e[t], v) {
			case r.START_BOUNDARY:
				if (_ === h.length - 2) {
					if (C === l) y |= a.LAST_BOUNDARY;
					else if (C !== s) return;
					_++;
					break;
				}
				if (_ - 1 == h.length - 2) {
					if (y & a.LAST_BOUNDARY && C === l) v = r.END, y = 0;
					else if (!(y & a.LAST_BOUNDARY) && C === o) _ = 0, D("onPartBegin"), v = r.HEADER_FIELD_START;
					else return;
					break;
				}
				C !== h[_ + 2] && (_ = -2), C === h[_ + 2] && _++;
				break;
			case r.HEADER_FIELD_START: v = r.HEADER_FIELD, T("onHeaderField"), _ = 0;
			case r.HEADER_FIELD:
				if (C === s) {
					E("onHeaderField"), v = r.HEADERS_ALMOST_DONE;
					break;
				}
				if (_++, C === l) break;
				if (C === u) {
					if (_ === 1) return;
					O("onHeaderField", !0), v = r.HEADER_VALUE_START;
					break;
				}
				if (w = p(C), w < d || w > f) return;
				break;
			case r.HEADER_VALUE_START:
				if (C === c) break;
				T("onHeaderValue"), v = r.HEADER_VALUE;
			case r.HEADER_VALUE:
				C === s && (O("onHeaderValue", !0), D("onHeaderEnd"), v = r.HEADER_VALUE_ALMOST_DONE);
				break;
			case r.HEADER_VALUE_ALMOST_DONE:
				if (C !== o) return;
				v = r.HEADER_FIELD_START;
				break;
			case r.HEADERS_ALMOST_DONE:
				if (C !== o) return;
				D("onHeadersEnd"), v = r.PART_DATA_START;
				break;
			case r.PART_DATA_START: v = r.PART_DATA, T("onPartData");
			case r.PART_DATA:
				if (i = _, _ === 0) {
					for (t += x; t < S && !(e[t] in g);) t += b;
					t -= x, C = e[t];
				}
				if (_ < h.length) h[_] === C ? (_ === 0 && O("onPartData", !0), _++) : _ = 0;
				else if (_ === h.length) _++, C === s ? y |= a.PART_BOUNDARY : C === l ? y |= a.LAST_BOUNDARY : _ = 0;
				else if (_ - 1 === h.length) {
					if (y & a.PART_BOUNDARY) {
						if (_ = 0, C === o) {
							y &= ~a.PART_BOUNDARY, D("onPartEnd"), D("onPartBegin"), v = r.HEADER_FIELD_START;
							break;
						}
					} else y & a.LAST_BOUNDARY && C === l ? (D("onPartEnd"), v = r.END, y = 0) : _ = 0;
				}
				if (_ > 0) m[_ - 1] = C;
				else if (i > 0) {
					let e = new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
					D("onPartData", 0, i, e), i = 0, T("onPartData"), t--;
				}
				break;
			case r.END: break;
			default: throw Error(`Unexpected state entered: ${v}`);
		}
		O("onHeaderField"), O("onHeaderValue"), O("onPartData"), this.index = _, this.state = v, this.flags = y;
	}
	end() {
		if (this.state === r.HEADER_FIELD_START && this.index === 0 || this.state === r.PART_DATA && this.index === this.boundary.length) this.onPartEnd();
		else if (this.state !== r.END) throw Error("MultipartParser.end(): stream ended unexpectedly");
	}
};
function g(e) {
	let t = e.match(/\bfilename=("(.*?)"|([^()<>@,;:\\"/[\]?={}\s\t]+))($|;\s)/i);
	if (!t) return;
	let n = t[2] || t[3] || "", r = n.slice(n.lastIndexOf("\\") + 1);
	return r = r.replace(/%22/g, "\""), r = r.replace(/&#(\d{4});/g, (e, t) => String.fromCharCode(t)), r;
}
async function _(n, r) {
	if (!/multipart/i.test(r)) throw TypeError("Failed to fetch");
	let i = r.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
	if (!i) throw TypeError("no or bad content-type header, no multipart boundary");
	let a = new h(i[1] || i[2]), o, s, c, l, u, d, f = [], p = new t(), m = (e) => {
		c += b.decode(e, { stream: !0 });
	}, _ = (e) => {
		f.push(e);
	}, v = () => {
		let t = new e(f, d, { type: u });
		p.append(l, t);
	}, y = () => {
		p.append(l, c);
	}, b = new TextDecoder("utf-8");
	b.decode(), a.onPartBegin = function() {
		a.onPartData = m, a.onPartEnd = y, o = "", s = "", c = "", l = "", u = "", d = null, f.length = 0;
	}, a.onHeaderField = function(e) {
		o += b.decode(e, { stream: !0 });
	}, a.onHeaderValue = function(e) {
		s += b.decode(e, { stream: !0 });
	}, a.onHeaderEnd = function() {
		if (s += b.decode(), o = o.toLowerCase(), o === "content-disposition") {
			let e = s.match(/\bname=("([^"]*)"|([^()<>@,;:\\"/[\]?={}\s\t]+))/i);
			e && (l = e[2] || e[3] || ""), d = g(s), d && (a.onPartData = _, a.onPartEnd = v);
		} else o === "content-type" && (u = s);
		s = "", o = "";
	};
	for await (let e of n) a.write(e);
	return a.end(), p;
}
//#endregion
export { _ as toFormData };
