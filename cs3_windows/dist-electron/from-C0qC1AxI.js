import { createRequire as e } from "node:module";
import { promises as t } from "node:fs";
//#region \0rolldown/runtime.js
var n = Object.create, r = Object.defineProperty, i = Object.getOwnPropertyDescriptor, a = Object.getOwnPropertyNames, o = Object.getPrototypeOf, s = Object.prototype.hasOwnProperty, c = (e, t, n) => () => {
	if (n) throw n[0];
	try {
		return e && (t = e(e = 0)), t;
	} catch (e) {
		throw n = [e], e;
	}
}, l = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), u = (e, t) => {
	let n = {};
	for (var i in e) r(n, i, {
		get: e[i],
		enumerable: !0
	});
	return t || r(n, Symbol.toStringTag, { value: "Module" }), n;
}, d = (e, t, n, o) => {
	if (t && typeof t == "object" || typeof t == "function") for (var c = a(t), l = 0, u = c.length, d; l < u; l++) d = c[l], !s.call(e, d) && d !== n && r(e, d, {
		get: ((e) => t[e]).bind(null, d),
		enumerable: !(o = i(t, d)) || o.enumerable
	});
	return e;
}, f = (e, t, i) => (i = e == null ? {} : n(o(e)), d(t || !e || !e.__esModule || !s.call(e, "default") ? r(i, "default", {
	value: e,
	enumerable: !0
}) : i, e)), p = (e) => s.call(e, "module.exports") ? e["module.exports"] : d(r({}, "__esModule", { value: !0 }), e), m = /* @__PURE__ */ e(import.meta.url), h = /* @__PURE__ */ l(((e, t) => {
	(function(n, r) {
		typeof e == "object" && t !== void 0 ? r(e) : typeof define == "function" && define.amd ? define(["exports"], r) : (n = typeof globalThis < "u" ? globalThis : n || self, r(n.WebStreamsPolyfill = {}));
	})(e, (function(e) {
		function t() {}
		function n(e) {
			return typeof e == "object" && !!e || typeof e == "function";
		}
		let r = t;
		function i(e, t) {
			try {
				Object.defineProperty(e, "name", {
					value: t,
					configurable: !0
				});
			} catch {}
		}
		let a = Promise, o = Promise.prototype.then, s = Promise.reject.bind(a);
		function c(e) {
			return new a(e);
		}
		function l(e) {
			return c((t) => t(e));
		}
		function u(e) {
			return s(e);
		}
		function d(e, t, n) {
			return o.call(e, t, n);
		}
		function f(e, t, n) {
			d(d(e, t, n), void 0, r);
		}
		function p(e, t) {
			f(e, t);
		}
		function m(e, t) {
			f(e, void 0, t);
		}
		function h(e, t, n) {
			return d(e, t, n);
		}
		function g(e) {
			d(e, void 0, r);
		}
		let _ = (e) => {
			if (typeof queueMicrotask == "function") _ = queueMicrotask;
			else {
				let e = l(void 0);
				_ = (t) => d(e, t);
			}
			return _(e);
		};
		function v(e, t, n) {
			if (typeof e != "function") throw TypeError("Argument is not a function");
			return Function.prototype.apply.call(e, t, n);
		}
		function y(e, t, n) {
			try {
				return l(v(e, t, n));
			} catch (e) {
				return u(e);
			}
		}
		class b {
			constructor() {
				this._cursor = 0, this._size = 0, this._front = {
					_elements: [],
					_next: void 0
				}, this._back = this._front, this._cursor = 0, this._size = 0;
			}
			get length() {
				return this._size;
			}
			push(e) {
				let t = this._back, n = t;
				t._elements.length === 16383 && (n = {
					_elements: [],
					_next: void 0
				}), t._elements.push(e), n !== t && (this._back = n, t._next = n), ++this._size;
			}
			shift() {
				let e = this._front, t = e, n = this._cursor, r = n + 1, i = e._elements, a = i[n];
				return r === 16384 && (t = e._next, r = 0), --this._size, this._cursor = r, e !== t && (this._front = t), i[n] = void 0, a;
			}
			forEach(e) {
				let t = this._cursor, n = this._front, r = n._elements;
				for (; (t !== r.length || n._next !== void 0) && !(t === r.length && (n = n._next, r = n._elements, t = 0, r.length === 0));) e(r[t]), ++t;
			}
			peek() {
				let e = this._front, t = this._cursor;
				return e._elements[t];
			}
		}
		let x = Symbol("[[AbortSteps]]"), ee = Symbol("[[ErrorSteps]]"), S = Symbol("[[CancelSteps]]"), C = Symbol("[[PullSteps]]"), te = Symbol("[[ReleaseSteps]]");
		function w(e, t) {
			e._ownerReadableStream = t, t._reader = e, t._state === "readable" ? ne(e) : t._state === "closed" ? ie(e) : re(e, t._storedError);
		}
		function T(e, t) {
			let n = e._ownerReadableStream;
			return Q(n, t);
		}
		function E(e) {
			let t = e._ownerReadableStream;
			t._state === "readable" ? ae(e, /* @__PURE__ */ TypeError("Reader was released and can no longer be used to monitor the stream's closedness")) : oe(e, /* @__PURE__ */ TypeError("Reader was released and can no longer be used to monitor the stream's closedness")), t._readableStreamController[te](), t._reader = void 0, e._ownerReadableStream = void 0;
		}
		function D(e) {
			return /* @__PURE__ */ TypeError("Cannot " + e + " a stream using a released reader");
		}
		function ne(e) {
			e._closedPromise = c((t, n) => {
				e._closedPromise_resolve = t, e._closedPromise_reject = n;
			});
		}
		function re(e, t) {
			ne(e), ae(e, t);
		}
		function ie(e) {
			ne(e), se(e);
		}
		function ae(e, t) {
			e._closedPromise_reject !== void 0 && (g(e._closedPromise), e._closedPromise_reject(t), e._closedPromise_resolve = void 0, e._closedPromise_reject = void 0);
		}
		function oe(e, t) {
			re(e, t);
		}
		function se(e) {
			e._closedPromise_resolve !== void 0 && (e._closedPromise_resolve(void 0), e._closedPromise_resolve = void 0, e._closedPromise_reject = void 0);
		}
		let ce = Number.isFinite || function(e) {
			return typeof e == "number" && isFinite(e);
		}, le = Math.trunc || function(e) {
			return e < 0 ? Math.ceil(e) : Math.floor(e);
		};
		function ue(e) {
			return typeof e == "object" || typeof e == "function";
		}
		function O(e, t) {
			if (e !== void 0 && !ue(e)) throw TypeError(`${t} is not an object.`);
		}
		function k(e, t) {
			if (typeof e != "function") throw TypeError(`${t} is not a function.`);
		}
		function de(e) {
			return typeof e == "object" && !!e || typeof e == "function";
		}
		function fe(e, t) {
			if (!de(e)) throw TypeError(`${t} is not an object.`);
		}
		function A(e, t, n) {
			if (e === void 0) throw TypeError(`Parameter ${t} is required in '${n}'.`);
		}
		function pe(e, t, n) {
			if (e === void 0) throw TypeError(`${t} is required in '${n}'.`);
		}
		function me(e) {
			return Number(e);
		}
		function he(e) {
			return e === 0 ? 0 : e;
		}
		function ge(e) {
			return he(le(e));
		}
		function _e(e, t) {
			let n = 2 ** 53 - 1, r = Number(e);
			if (r = he(r), !ce(r)) throw TypeError(`${t} is not a finite number`);
			if (r = ge(r), r < 0 || r > n) throw TypeError(`${t} is outside the accepted range of 0 to ${n}, inclusive`);
			return !ce(r) || r === 0 ? 0 : r;
		}
		function ve(e, t) {
			if (!X(e)) throw TypeError(`${t} is not a ReadableStream.`);
		}
		function ye(e) {
			return new j(e);
		}
		function be(e, t) {
			e._reader._readRequests.push(t);
		}
		function xe(e, t, n) {
			let r = e._reader._readRequests.shift();
			n ? r._closeSteps() : r._chunkSteps(t);
		}
		function Se(e) {
			return e._reader._readRequests.length;
		}
		function Ce(e) {
			let t = e._reader;
			return !(t === void 0 || !M(t));
		}
		class j {
			constructor(e) {
				if (A(e, 1, "ReadableStreamDefaultReader"), ve(e, "First parameter"), Z(e)) throw TypeError("This stream has already been locked for exclusive reading by another reader");
				w(this, e), this._readRequests = new b();
			}
			get closed() {
				return M(this) ? this._closedPromise : u(De("closed"));
			}
			cancel(e = void 0) {
				return M(this) ? this._ownerReadableStream === void 0 ? u(D("cancel")) : T(this, e) : u(De("cancel"));
			}
			read() {
				if (!M(this)) return u(De("read"));
				if (this._ownerReadableStream === void 0) return u(D("read from"));
				let e, t, n = c((n, r) => {
					e = n, t = r;
				});
				return we(this, {
					_chunkSteps: (t) => e({
						value: t,
						done: !1
					}),
					_closeSteps: () => e({
						value: void 0,
						done: !0
					}),
					_errorSteps: (e) => t(e)
				}), n;
			}
			releaseLock() {
				if (!M(this)) throw De("releaseLock");
				this._ownerReadableStream !== void 0 && Te(this);
			}
		}
		Object.defineProperties(j.prototype, {
			cancel: { enumerable: !0 },
			read: { enumerable: !0 },
			releaseLock: { enumerable: !0 },
			closed: { enumerable: !0 }
		}), i(j.prototype.cancel, "cancel"), i(j.prototype.read, "read"), i(j.prototype.releaseLock, "releaseLock"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(j.prototype, Symbol.toStringTag, {
			value: "ReadableStreamDefaultReader",
			configurable: !0
		});
		function M(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_readRequests") ? !1 : e instanceof j;
		}
		function we(e, t) {
			let n = e._ownerReadableStream;
			n._disturbed = !0, n._state === "closed" ? t._closeSteps() : n._state === "errored" ? t._errorSteps(n._storedError) : n._readableStreamController[C](t);
		}
		function Te(e) {
			E(e), Ee(e, /* @__PURE__ */ TypeError("Reader was released"));
		}
		function Ee(e, t) {
			let n = e._readRequests;
			e._readRequests = new b(), n.forEach((e) => {
				e._errorSteps(t);
			});
		}
		function De(e) {
			return /* @__PURE__ */ TypeError(`ReadableStreamDefaultReader.prototype.${e} can only be used on a ReadableStreamDefaultReader`);
		}
		let Oe = Object.getPrototypeOf(Object.getPrototypeOf(async function* () {}).prototype);
		class ke {
			constructor(e, t) {
				this._ongoingPromise = void 0, this._isFinished = !1, this._reader = e, this._preventCancel = t;
			}
			next() {
				let e = () => this._nextSteps();
				return this._ongoingPromise = this._ongoingPromise ? h(this._ongoingPromise, e, e) : e(), this._ongoingPromise;
			}
			return(e) {
				let t = () => this._returnSteps(e);
				return this._ongoingPromise ? h(this._ongoingPromise, t, t) : t();
			}
			_nextSteps() {
				if (this._isFinished) return Promise.resolve({
					value: void 0,
					done: !0
				});
				let e = this._reader, t, n, r = c((e, r) => {
					t = e, n = r;
				});
				return we(e, {
					_chunkSteps: (e) => {
						this._ongoingPromise = void 0, _(() => t({
							value: e,
							done: !1
						}));
					},
					_closeSteps: () => {
						this._ongoingPromise = void 0, this._isFinished = !0, E(e), t({
							value: void 0,
							done: !0
						});
					},
					_errorSteps: (t) => {
						this._ongoingPromise = void 0, this._isFinished = !0, E(e), n(t);
					}
				}), r;
			}
			_returnSteps(e) {
				if (this._isFinished) return Promise.resolve({
					value: e,
					done: !0
				});
				this._isFinished = !0;
				let t = this._reader;
				if (!this._preventCancel) {
					let n = T(t, e);
					return E(t), h(n, () => ({
						value: e,
						done: !0
					}));
				}
				return E(t), l({
					value: e,
					done: !0
				});
			}
		}
		let Ae = {
			next() {
				return Me(this) ? this._asyncIteratorImpl.next() : u(Ne("next"));
			},
			return(e) {
				return Me(this) ? this._asyncIteratorImpl.return(e) : u(Ne("return"));
			}
		};
		Object.setPrototypeOf(Ae, Oe);
		function je(e, t) {
			let n = ye(e), r = new ke(n, t), i = Object.create(Ae);
			return i._asyncIteratorImpl = r, i;
		}
		function Me(e) {
			if (!n(e) || !Object.prototype.hasOwnProperty.call(e, "_asyncIteratorImpl")) return !1;
			try {
				return e._asyncIteratorImpl instanceof ke;
			} catch {
				return !1;
			}
		}
		function Ne(e) {
			return /* @__PURE__ */ TypeError(`ReadableStreamAsyncIterator.${e} can only be used on a ReadableSteamAsyncIterator`);
		}
		let Pe = Number.isNaN || function(e) {
			return e !== e;
		};
		function Fe(e) {
			return e.slice();
		}
		function Ie(e, t, n, r, i) {
			new Uint8Array(e).set(new Uint8Array(n, r, i), t);
		}
		let N = (e) => (N = typeof e.transfer == "function" ? (e) => e.transfer() : typeof structuredClone == "function" ? (e) => structuredClone(e, { transfer: [e] }) : (e) => e, N(e)), P = (e) => (P = typeof e.detached == "boolean" ? (e) => e.detached : (e) => e.byteLength === 0, P(e));
		function Le(e, t, n) {
			if (e.slice) return e.slice(t, n);
			let r = n - t, i = new ArrayBuffer(r);
			return Ie(i, 0, e, t, r), i;
		}
		function Re(e, t) {
			let n = e[t];
			if (n != null) {
				if (typeof n != "function") throw TypeError(`${String(t)} is not a function`);
				return n;
			}
		}
		function ze(e) {
			let t = { [Symbol.iterator]: () => e.iterator }, n = async function* () {
				return yield* t;
			}();
			return {
				iterator: n,
				nextMethod: n.next,
				done: !1
			};
		}
		let Be = Symbol.asyncIterator ?? Symbol.for?.call(Symbol, "Symbol.asyncIterator") ?? "@@asyncIterator";
		function Ve(e, t = "sync", r) {
			if (r === void 0) {
				if (t === "async") {
					if (r = Re(e, Be), r === void 0) return ze(Ve(e, "sync", Re(e, Symbol.iterator)));
				} else r = Re(e, Symbol.iterator);
			}
			if (r === void 0) throw TypeError("The object is not iterable");
			let i = v(r, e, []);
			if (!n(i)) throw TypeError("The iterator method must return an object");
			return {
				iterator: i,
				nextMethod: i.next,
				done: !1
			};
		}
		function He(e) {
			let t = v(e.nextMethod, e.iterator, []);
			if (!n(t)) throw TypeError("The iterator.next() method must return an object");
			return t;
		}
		function Ue(e) {
			return !!e.done;
		}
		function We(e) {
			return e.value;
		}
		function Ge(e) {
			return !(typeof e != "number" || Pe(e) || e < 0);
		}
		function Ke(e) {
			let t = Le(e.buffer, e.byteOffset, e.byteOffset + e.byteLength);
			return new Uint8Array(t);
		}
		function qe(e) {
			let t = e._queue.shift();
			return e._queueTotalSize -= t.size, e._queueTotalSize < 0 && (e._queueTotalSize = 0), t.value;
		}
		function Je(e, t, n) {
			if (!Ge(n) || n === Infinity) throw RangeError("Size must be a finite, non-NaN, non-negative number.");
			e._queue.push({
				value: t,
				size: n
			}), e._queueTotalSize += n;
		}
		function Ye(e) {
			return e._queue.peek().value;
		}
		function F(e) {
			e._queue = new b(), e._queueTotalSize = 0;
		}
		function Xe(e) {
			return e === DataView;
		}
		function Ze(e) {
			return Xe(e.constructor);
		}
		function Qe(e) {
			return Xe(e) ? 1 : e.BYTES_PER_ELEMENT;
		}
		class I {
			constructor() {
				throw TypeError("Illegal constructor");
			}
			get view() {
				if (!et(this)) throw jt("view");
				return this._view;
			}
			respond(e) {
				if (!et(this)) throw jt("respond");
				if (A(e, 1, "respond"), e = _e(e, "First parameter"), this._associatedReadableByteStreamController === void 0) throw TypeError("This BYOB request has been invalidated");
				if (P(this._view.buffer)) throw TypeError("The BYOB request's buffer has been detached and so cannot be used as a response");
				Et(this._associatedReadableByteStreamController, e);
			}
			respondWithNewView(e) {
				if (!et(this)) throw jt("respondWithNewView");
				if (A(e, 1, "respondWithNewView"), !ArrayBuffer.isView(e)) throw TypeError("You can only respond with array buffer views");
				if (this._associatedReadableByteStreamController === void 0) throw TypeError("This BYOB request has been invalidated");
				if (P(e.buffer)) throw TypeError("The given view's buffer has been detached and so cannot be used as a response");
				Dt(this._associatedReadableByteStreamController, e);
			}
		}
		Object.defineProperties(I.prototype, {
			respond: { enumerable: !0 },
			respondWithNewView: { enumerable: !0 },
			view: { enumerable: !0 }
		}), i(I.prototype.respond, "respond"), i(I.prototype.respondWithNewView, "respondWithNewView"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(I.prototype, Symbol.toStringTag, {
			value: "ReadableStreamBYOBRequest",
			configurable: !0
		});
		class L {
			constructor() {
				throw TypeError("Illegal constructor");
			}
			get byobRequest() {
				if (!$e(this)) throw Mt("byobRequest");
				return wt(this);
			}
			get desiredSize() {
				if (!$e(this)) throw Mt("desiredSize");
				return Tt(this);
			}
			close() {
				if (!$e(this)) throw Mt("close");
				if (this._closeRequested) throw TypeError("The stream has already been closed; do not close it again!");
				let e = this._controlledReadableByteStream._state;
				if (e !== "readable") throw TypeError(`The stream (in ${e} state) is not in the readable state and cannot be closed`);
				xt(this);
			}
			enqueue(e) {
				if (!$e(this)) throw Mt("enqueue");
				if (A(e, 1, "enqueue"), !ArrayBuffer.isView(e)) throw TypeError("chunk must be an array buffer view");
				if (e.byteLength === 0) throw TypeError("chunk must have non-zero byteLength");
				if (e.buffer.byteLength === 0) throw TypeError("chunk's buffer must have non-zero byteLength");
				if (this._closeRequested) throw TypeError("stream is closed or draining");
				let t = this._controlledReadableByteStream._state;
				if (t !== "readable") throw TypeError(`The stream (in ${t} state) is not in the readable state and cannot be enqueued to`);
				St(this, e);
			}
			error(e = void 0) {
				if (!$e(this)) throw Mt("error");
				R(this, e);
			}
			[S](e) {
				nt(this), F(this);
				let t = this._cancelAlgorithm(e);
				return bt(this), t;
			}
			[C](e) {
				let t = this._controlledReadableByteStream;
				if (this._queueTotalSize > 0) {
					Ct(this, e);
					return;
				}
				let n = this._autoAllocateChunkSize;
				if (n !== void 0) {
					let t;
					try {
						t = new ArrayBuffer(n);
					} catch (t) {
						e._errorSteps(t);
						return;
					}
					let r = {
						buffer: t,
						bufferByteLength: n,
						byteOffset: 0,
						byteLength: n,
						bytesFilled: 0,
						minimumFill: 1,
						elementSize: 1,
						viewConstructor: Uint8Array,
						readerType: "default"
					};
					this._pendingPullIntos.push(r);
				}
				be(t, e), tt(this);
			}
			[te]() {
				if (this._pendingPullIntos.length > 0) {
					let e = this._pendingPullIntos.peek();
					e.readerType = "none", this._pendingPullIntos = new b(), this._pendingPullIntos.push(e);
				}
			}
		}
		Object.defineProperties(L.prototype, {
			close: { enumerable: !0 },
			enqueue: { enumerable: !0 },
			error: { enumerable: !0 },
			byobRequest: { enumerable: !0 },
			desiredSize: { enumerable: !0 }
		}), i(L.prototype.close, "close"), i(L.prototype.enqueue, "enqueue"), i(L.prototype.error, "error"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(L.prototype, Symbol.toStringTag, {
			value: "ReadableByteStreamController",
			configurable: !0
		});
		function $e(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_controlledReadableByteStream") ? !1 : e instanceof L;
		}
		function et(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_associatedReadableByteStreamController") ? !1 : e instanceof I;
		}
		function tt(e) {
			if (yt(e)) {
				if (e._pulling) {
					e._pullAgain = !0;
					return;
				}
				e._pulling = !0, f(e._pullAlgorithm(), () => (e._pulling = !1, e._pullAgain && (e._pullAgain = !1, tt(e)), null), (t) => (R(e, t), null));
			}
		}
		function nt(e) {
			dt(e), e._pendingPullIntos = new b();
		}
		function rt(e, t) {
			let n = !1;
			e._state === "closed" && (n = !0);
			let r = it(t);
			t.readerType === "default" ? xe(e, r, n) : Rt(e, r, n);
		}
		function it(e) {
			let t = e.bytesFilled, n = e.elementSize;
			return new e.viewConstructor(e.buffer, e.byteOffset, t / n);
		}
		function at(e, t, n, r) {
			e._queue.push({
				buffer: t,
				byteOffset: n,
				byteLength: r
			}), e._queueTotalSize += r;
		}
		function ot(e, t, n, r) {
			let i;
			try {
				i = Le(t, n, n + r);
			} catch (t) {
				throw R(e, t), t;
			}
			at(e, i, 0, r);
		}
		function st(e, t) {
			t.bytesFilled > 0 && ot(e, t.buffer, t.byteOffset, t.bytesFilled), vt(e);
		}
		function ct(e, t) {
			let n = Math.min(e._queueTotalSize, t.byteLength - t.bytesFilled), r = t.bytesFilled + n, i = n, a = !1, o = r - r % t.elementSize;
			o >= t.minimumFill && (i = o - t.bytesFilled, a = !0);
			let s = e._queue;
			for (; i > 0;) {
				let n = s.peek(), r = Math.min(i, n.byteLength), a = t.byteOffset + t.bytesFilled;
				Ie(t.buffer, a, n.buffer, n.byteOffset, r), n.byteLength === r ? s.shift() : (n.byteOffset += r, n.byteLength -= r), e._queueTotalSize -= r, lt(e, r, t), i -= r;
			}
			return a;
		}
		function lt(e, t, n) {
			n.bytesFilled += t;
		}
		function ut(e) {
			e._queueTotalSize === 0 && e._closeRequested ? (bt(e), Jr(e._controlledReadableByteStream)) : tt(e);
		}
		function dt(e) {
			e._byobRequest !== null && (e._byobRequest._associatedReadableByteStreamController = void 0, e._byobRequest._view = null, e._byobRequest = null);
		}
		function ft(e) {
			for (; e._pendingPullIntos.length > 0;) {
				if (e._queueTotalSize === 0) return;
				let t = e._pendingPullIntos.peek();
				ct(e, t) && (vt(e), rt(e._controlledReadableByteStream, t));
			}
		}
		function pt(e) {
			let t = e._controlledReadableByteStream._reader;
			for (; t._readRequests.length > 0;) {
				if (e._queueTotalSize === 0) return;
				Ct(e, t._readRequests.shift());
			}
		}
		function mt(e, t, n, r) {
			let i = e._controlledReadableByteStream, a = t.constructor, o = Qe(a), { byteOffset: s, byteLength: c } = t, l = n * o, u;
			try {
				u = N(t.buffer);
			} catch (e) {
				r._errorSteps(e);
				return;
			}
			let d = {
				buffer: u,
				bufferByteLength: u.byteLength,
				byteOffset: s,
				byteLength: c,
				bytesFilled: 0,
				minimumFill: l,
				elementSize: o,
				viewConstructor: a,
				readerType: "byob"
			};
			if (e._pendingPullIntos.length > 0) {
				e._pendingPullIntos.push(d), Lt(i, r);
				return;
			}
			if (i._state === "closed") {
				let e = new a(d.buffer, d.byteOffset, 0);
				r._closeSteps(e);
				return;
			}
			if (e._queueTotalSize > 0) {
				if (ct(e, d)) {
					let t = it(d);
					ut(e), r._chunkSteps(t);
					return;
				}
				if (e._closeRequested) {
					let t = /* @__PURE__ */ TypeError("Insufficient bytes to fill elements in the given buffer");
					R(e, t), r._errorSteps(t);
					return;
				}
			}
			e._pendingPullIntos.push(d), Lt(i, r), tt(e);
		}
		function ht(e, t) {
			t.readerType === "none" && vt(e);
			let n = e._controlledReadableByteStream;
			if (Bt(n)) for (; zt(n) > 0;) rt(n, vt(e));
		}
		function gt(e, t, n) {
			if (lt(e, t, n), n.readerType === "none") {
				st(e, n), ft(e);
				return;
			}
			if (n.bytesFilled < n.minimumFill) return;
			vt(e);
			let r = n.bytesFilled % n.elementSize;
			if (r > 0) {
				let t = n.byteOffset + n.bytesFilled;
				ot(e, n.buffer, t - r, r);
			}
			n.bytesFilled -= r, rt(e._controlledReadableByteStream, n), ft(e);
		}
		function _t(e, t) {
			let n = e._pendingPullIntos.peek();
			dt(e), e._controlledReadableByteStream._state === "closed" ? ht(e, n) : gt(e, t, n), tt(e);
		}
		function vt(e) {
			return e._pendingPullIntos.shift();
		}
		function yt(e) {
			let t = e._controlledReadableByteStream;
			return t._state !== "readable" || e._closeRequested || !e._started ? !1 : !!(Ce(t) && Se(t) > 0 || Bt(t) && zt(t) > 0 || Tt(e) > 0);
		}
		function bt(e) {
			e._pullAlgorithm = void 0, e._cancelAlgorithm = void 0;
		}
		function xt(e) {
			let t = e._controlledReadableByteStream;
			if (!(e._closeRequested || t._state !== "readable")) {
				if (e._queueTotalSize > 0) {
					e._closeRequested = !0;
					return;
				}
				if (e._pendingPullIntos.length > 0) {
					let t = e._pendingPullIntos.peek();
					if (t.bytesFilled % t.elementSize !== 0) {
						let t = /* @__PURE__ */ TypeError("Insufficient bytes to fill elements in the given buffer");
						throw R(e, t), t;
					}
				}
				bt(e), Jr(t);
			}
		}
		function St(e, t) {
			let n = e._controlledReadableByteStream;
			if (e._closeRequested || n._state !== "readable") return;
			let { buffer: r, byteOffset: i, byteLength: a } = t;
			if (P(r)) throw TypeError("chunk's buffer is detached and so cannot be enqueued");
			let o = N(r);
			if (e._pendingPullIntos.length > 0) {
				let t = e._pendingPullIntos.peek();
				if (P(t.buffer)) throw TypeError("The BYOB request's buffer has been detached and so cannot be filled with an enqueued chunk");
				dt(e), t.buffer = N(t.buffer), t.readerType === "none" && st(e, t);
			}
			Ce(n) ? (pt(e), Se(n) === 0 ? at(e, o, i, a) : (e._pendingPullIntos.length > 0 && vt(e), xe(n, new Uint8Array(o, i, a), !1))) : Bt(n) ? (at(e, o, i, a), ft(e)) : at(e, o, i, a), tt(e);
		}
		function R(e, t) {
			let n = e._controlledReadableByteStream;
			n._state === "readable" && (nt(e), F(e), bt(e), Yr(n, t));
		}
		function Ct(e, t) {
			let n = e._queue.shift();
			e._queueTotalSize -= n.byteLength, ut(e);
			let r = new Uint8Array(n.buffer, n.byteOffset, n.byteLength);
			t._chunkSteps(r);
		}
		function wt(e) {
			if (e._byobRequest === null && e._pendingPullIntos.length > 0) {
				let t = e._pendingPullIntos.peek(), n = new Uint8Array(t.buffer, t.byteOffset + t.bytesFilled, t.byteLength - t.bytesFilled), r = Object.create(I.prototype);
				At(r, e, n), e._byobRequest = r;
			}
			return e._byobRequest;
		}
		function Tt(e) {
			let t = e._controlledReadableByteStream._state;
			return t === "errored" ? null : t === "closed" ? 0 : e._strategyHWM - e._queueTotalSize;
		}
		function Et(e, t) {
			let n = e._pendingPullIntos.peek();
			if (e._controlledReadableByteStream._state === "closed") {
				if (t !== 0) throw TypeError("bytesWritten must be 0 when calling respond() on a closed stream");
			} else {
				if (t === 0) throw TypeError("bytesWritten must be greater than 0 when calling respond() on a readable stream");
				if (n.bytesFilled + t > n.byteLength) throw RangeError("bytesWritten out of range");
			}
			n.buffer = N(n.buffer), _t(e, t);
		}
		function Dt(e, t) {
			let n = e._pendingPullIntos.peek();
			if (e._controlledReadableByteStream._state === "closed") {
				if (t.byteLength !== 0) throw TypeError("The view's length must be 0 when calling respondWithNewView() on a closed stream");
			} else if (t.byteLength === 0) throw TypeError("The view's length must be greater than 0 when calling respondWithNewView() on a readable stream");
			if (n.byteOffset + n.bytesFilled !== t.byteOffset) throw RangeError("The region specified by view does not match byobRequest");
			if (n.bufferByteLength !== t.buffer.byteLength) throw RangeError("The buffer of view has different capacity than byobRequest");
			if (n.bytesFilled + t.byteLength > n.byteLength) throw RangeError("The region specified by view is larger than byobRequest");
			let r = t.byteLength;
			n.buffer = N(t.buffer), _t(e, r);
		}
		function Ot(e, t, n, r, i, a, o) {
			t._controlledReadableByteStream = e, t._pullAgain = !1, t._pulling = !1, t._byobRequest = null, t._queue = t._queueTotalSize = void 0, F(t), t._closeRequested = !1, t._started = !1, t._strategyHWM = a, t._pullAlgorithm = r, t._cancelAlgorithm = i, t._autoAllocateChunkSize = o, t._pendingPullIntos = new b(), e._readableStreamController = t, f(l(n()), () => (t._started = !0, tt(t), null), (e) => (R(t, e), null));
		}
		function kt(e, t, n) {
			let r = Object.create(L.prototype), i, a, o;
			i = t.start === void 0 ? () => void 0 : () => t.start(r), a = t.pull === void 0 ? () => l(void 0) : () => t.pull(r), o = t.cancel === void 0 ? () => l(void 0) : (e) => t.cancel(e);
			let s = t.autoAllocateChunkSize;
			if (s === 0) throw TypeError("autoAllocateChunkSize must be greater than 0");
			Ot(e, r, i, a, o, n, s);
		}
		function At(e, t, n) {
			e._associatedReadableByteStreamController = t, e._view = n;
		}
		function jt(e) {
			return /* @__PURE__ */ TypeError(`ReadableStreamBYOBRequest.prototype.${e} can only be used on a ReadableStreamBYOBRequest`);
		}
		function Mt(e) {
			return /* @__PURE__ */ TypeError(`ReadableByteStreamController.prototype.${e} can only be used on a ReadableByteStreamController`);
		}
		function Nt(e, t) {
			O(e, t);
			let n = e?.mode;
			return { mode: n === void 0 ? void 0 : Pt(n, `${t} has member 'mode' that`) };
		}
		function Pt(e, t) {
			if (e = `${e}`, e !== "byob") throw TypeError(`${t} '${e}' is not a valid enumeration value for ReadableStreamReaderMode`);
			return e;
		}
		function Ft(e, t) {
			return O(e, t), { min: _e(e?.min ?? 1, `${t} has member 'min' that`) };
		}
		function It(e) {
			return new z(e);
		}
		function Lt(e, t) {
			e._reader._readIntoRequests.push(t);
		}
		function Rt(e, t, n) {
			let r = e._reader._readIntoRequests.shift();
			n ? r._closeSteps(t) : r._chunkSteps(t);
		}
		function zt(e) {
			return e._reader._readIntoRequests.length;
		}
		function Bt(e) {
			let t = e._reader;
			return !(t === void 0 || !B(t));
		}
		class z {
			constructor(e) {
				if (A(e, 1, "ReadableStreamBYOBReader"), ve(e, "First parameter"), Z(e)) throw TypeError("This stream has already been locked for exclusive reading by another reader");
				if (!$e(e._readableStreamController)) throw TypeError("Cannot construct a ReadableStreamBYOBReader for a stream not constructed with a byte source");
				w(this, e), this._readIntoRequests = new b();
			}
			get closed() {
				return B(this) ? this._closedPromise : u(Wt("closed"));
			}
			cancel(e = void 0) {
				return B(this) ? this._ownerReadableStream === void 0 ? u(D("cancel")) : T(this, e) : u(Wt("cancel"));
			}
			read(e, t = {}) {
				if (!B(this)) return u(Wt("read"));
				if (!ArrayBuffer.isView(e)) return u(/* @__PURE__ */ TypeError("view must be an array buffer view"));
				if (e.byteLength === 0) return u(/* @__PURE__ */ TypeError("view must have non-zero byteLength"));
				if (e.buffer.byteLength === 0) return u(/* @__PURE__ */ TypeError("view's buffer must have non-zero byteLength"));
				if (P(e.buffer)) return u(/* @__PURE__ */ TypeError("view's buffer has been detached"));
				let n;
				try {
					n = Ft(t, "options");
				} catch (e) {
					return u(e);
				}
				let r = n.min;
				if (r === 0) return u(/* @__PURE__ */ TypeError("options.min must be greater than 0"));
				if (!Ze(e)) {
					if (r > e.length) return u(/* @__PURE__ */ RangeError("options.min must be less than or equal to view's length"));
				} else if (r > e.byteLength) return u(/* @__PURE__ */ RangeError("options.min must be less than or equal to view's byteLength"));
				if (this._ownerReadableStream === void 0) return u(D("read from"));
				let i, a, o = c((e, t) => {
					i = e, a = t;
				});
				return Vt(this, e, r, {
					_chunkSteps: (e) => i({
						value: e,
						done: !1
					}),
					_closeSteps: (e) => i({
						value: e,
						done: !0
					}),
					_errorSteps: (e) => a(e)
				}), o;
			}
			releaseLock() {
				if (!B(this)) throw Wt("releaseLock");
				this._ownerReadableStream !== void 0 && Ht(this);
			}
		}
		Object.defineProperties(z.prototype, {
			cancel: { enumerable: !0 },
			read: { enumerable: !0 },
			releaseLock: { enumerable: !0 },
			closed: { enumerable: !0 }
		}), i(z.prototype.cancel, "cancel"), i(z.prototype.read, "read"), i(z.prototype.releaseLock, "releaseLock"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(z.prototype, Symbol.toStringTag, {
			value: "ReadableStreamBYOBReader",
			configurable: !0
		});
		function B(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_readIntoRequests") ? !1 : e instanceof z;
		}
		function Vt(e, t, n, r) {
			let i = e._ownerReadableStream;
			i._disturbed = !0, i._state === "errored" ? r._errorSteps(i._storedError) : mt(i._readableStreamController, t, n, r);
		}
		function Ht(e) {
			E(e), Ut(e, /* @__PURE__ */ TypeError("Reader was released"));
		}
		function Ut(e, t) {
			let n = e._readIntoRequests;
			e._readIntoRequests = new b(), n.forEach((e) => {
				e._errorSteps(t);
			});
		}
		function Wt(e) {
			return /* @__PURE__ */ TypeError(`ReadableStreamBYOBReader.prototype.${e} can only be used on a ReadableStreamBYOBReader`);
		}
		function Gt(e, t) {
			let { highWaterMark: n } = e;
			if (n === void 0) return t;
			if (Pe(n) || n < 0) throw RangeError("Invalid highWaterMark");
			return n;
		}
		function Kt(e) {
			let { size: t } = e;
			return t || (() => 1);
		}
		function qt(e, t) {
			O(e, t);
			let n = e?.highWaterMark, r = e?.size;
			return {
				highWaterMark: n === void 0 ? void 0 : me(n),
				size: r === void 0 ? void 0 : Jt(r, `${t} has member 'size' that`)
			};
		}
		function Jt(e, t) {
			return k(e, t), (t) => me(e(t));
		}
		function Yt(e, t) {
			O(e, t);
			let n = e?.abort, r = e?.close, i = e?.start, a = e?.type, o = e?.write;
			return {
				abort: n === void 0 ? void 0 : Xt(n, e, `${t} has member 'abort' that`),
				close: r === void 0 ? void 0 : Zt(r, e, `${t} has member 'close' that`),
				start: i === void 0 ? void 0 : Qt(i, e, `${t} has member 'start' that`),
				write: o === void 0 ? void 0 : $t(o, e, `${t} has member 'write' that`),
				type: a
			};
		}
		function Xt(e, t, n) {
			return k(e, n), (n) => y(e, t, [n]);
		}
		function Zt(e, t, n) {
			return k(e, n), () => y(e, t, []);
		}
		function Qt(e, t, n) {
			return k(e, n), (n) => v(e, t, [n]);
		}
		function $t(e, t, n) {
			return k(e, n), (n, r) => y(e, t, [n, r]);
		}
		function en(e, t) {
			if (!cn(e)) throw TypeError(`${t} is not a WritableStream.`);
		}
		function tn(e) {
			if (typeof e != "object" || !e) return !1;
			try {
				return typeof e.aborted == "boolean";
			} catch {
				return !1;
			}
		}
		let nn = typeof AbortController == "function";
		function rn() {
			if (nn) return new AbortController();
		}
		class V {
			constructor(e = {}, t = {}) {
				e === void 0 ? e = null : fe(e, "First parameter");
				let n = qt(t, "Second parameter"), r = Yt(e, "First parameter");
				if (sn(this), r.type !== void 0) throw RangeError("Invalid type is specified");
				let i = Kt(n), a = Gt(n, 1);
				Ln(this, r, a, i);
			}
			get locked() {
				if (!cn(this)) throw Yn("locked");
				return ln(this);
			}
			abort(e = void 0) {
				return cn(this) ? ln(this) ? u(/* @__PURE__ */ TypeError("Cannot abort a stream that already has a writer")) : un(this, e) : u(Yn("abort"));
			}
			close() {
				return cn(this) ? ln(this) ? u(/* @__PURE__ */ TypeError("Cannot close a stream that already has a writer")) : H(this) ? u(/* @__PURE__ */ TypeError("Cannot close an already-closing stream")) : dn(this) : u(Yn("close"));
			}
			getWriter() {
				if (!cn(this)) throw Yn("getWriter");
				return an(this);
			}
		}
		Object.defineProperties(V.prototype, {
			abort: { enumerable: !0 },
			close: { enumerable: !0 },
			getWriter: { enumerable: !0 },
			locked: { enumerable: !0 }
		}), i(V.prototype.abort, "abort"), i(V.prototype.close, "close"), i(V.prototype.getWriter, "getWriter"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(V.prototype, Symbol.toStringTag, {
			value: "WritableStream",
			configurable: !0
		});
		function an(e) {
			return new U(e);
		}
		function on(e, t, n, r, i = 1, a = () => 1) {
			let o = Object.create(V.prototype);
			return sn(o), In(o, Object.create(Pn.prototype), e, t, n, r, i, a), o;
		}
		function sn(e) {
			e._state = "writable", e._storedError = void 0, e._writer = void 0, e._writableStreamController = void 0, e._writeRequests = new b(), e._inFlightWriteRequest = void 0, e._closeRequest = void 0, e._inFlightCloseRequest = void 0, e._pendingAbortRequest = void 0, e._backpressure = !1;
		}
		function cn(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_writableStreamController") ? !1 : e instanceof V;
		}
		function ln(e) {
			return e._writer !== void 0;
		}
		function un(e, t) {
			var n;
			if (e._state === "closed" || e._state === "errored") return l(void 0);
			e._writableStreamController._abortReason = t, (n = e._writableStreamController._abortController) == null || n.abort(t);
			let r = e._state;
			if (r === "closed" || r === "errored") return l(void 0);
			if (e._pendingAbortRequest !== void 0) return e._pendingAbortRequest._promise;
			let i = !1;
			r === "erroring" && (i = !0, t = void 0);
			let a = c((n, r) => {
				e._pendingAbortRequest = {
					_promise: void 0,
					_resolve: n,
					_reject: r,
					_reason: t,
					_wasAlreadyErroring: i
				};
			});
			return e._pendingAbortRequest._promise = a, i || mn(e, t), a;
		}
		function dn(e) {
			let t = e._state;
			if (t === "closed" || t === "errored") return u(/* @__PURE__ */ TypeError(`The stream (in ${t} state) is not in the writable state and cannot be closed`));
			let n = c((t, n) => {
				e._closeRequest = {
					_resolve: t,
					_reject: n
				};
			}), r = e._writer;
			return r !== void 0 && e._backpressure && t === "writable" && ur(r), zn(e._writableStreamController), n;
		}
		function fn(e) {
			return c((t, n) => {
				let r = {
					_resolve: t,
					_reject: n
				};
				e._writeRequests.push(r);
			});
		}
		function pn(e, t) {
			if (e._state === "writable") {
				mn(e, t);
				return;
			}
			hn(e);
		}
		function mn(e, t) {
			let n = e._writableStreamController;
			e._state = "erroring", e._storedError = t;
			let r = e._writer;
			r !== void 0 && kn(r, t), !bn(e) && n._started && hn(e);
		}
		function hn(e) {
			e._state = "errored", e._writableStreamController[ee]();
			let t = e._storedError;
			if (e._writeRequests.forEach((e) => {
				e._reject(t);
			}), e._writeRequests = new b(), e._pendingAbortRequest === void 0) {
				Cn(e);
				return;
			}
			let n = e._pendingAbortRequest;
			if (e._pendingAbortRequest = void 0, n._wasAlreadyErroring) {
				n._reject(t), Cn(e);
				return;
			}
			f(e._writableStreamController[x](n._reason), () => (n._resolve(), Cn(e), null), (t) => (n._reject(t), Cn(e), null));
		}
		function gn(e) {
			e._inFlightWriteRequest._resolve(void 0), e._inFlightWriteRequest = void 0;
		}
		function _n(e, t) {
			e._inFlightWriteRequest._reject(t), e._inFlightWriteRequest = void 0, pn(e, t);
		}
		function vn(e) {
			e._inFlightCloseRequest._resolve(void 0), e._inFlightCloseRequest = void 0, e._state === "erroring" && (e._storedError = void 0, e._pendingAbortRequest !== void 0 && (e._pendingAbortRequest._resolve(), e._pendingAbortRequest = void 0)), e._state = "closed";
			let t = e._writer;
			t !== void 0 && rr(t);
		}
		function yn(e, t) {
			e._inFlightCloseRequest._reject(t), e._inFlightCloseRequest = void 0, e._pendingAbortRequest !== void 0 && (e._pendingAbortRequest._reject(t), e._pendingAbortRequest = void 0), pn(e, t);
		}
		function H(e) {
			return e._closeRequest !== void 0 || e._inFlightCloseRequest !== void 0;
		}
		function bn(e) {
			return e._inFlightWriteRequest !== void 0 || e._inFlightCloseRequest !== void 0;
		}
		function xn(e) {
			e._inFlightCloseRequest = e._closeRequest, e._closeRequest = void 0;
		}
		function Sn(e) {
			e._inFlightWriteRequest = e._writeRequests.shift();
		}
		function Cn(e) {
			e._closeRequest !== void 0 && (e._closeRequest._reject(e._storedError), e._closeRequest = void 0);
			let t = e._writer;
			t !== void 0 && tr(t, e._storedError);
		}
		function wn(e, t) {
			let n = e._writer;
			n !== void 0 && t !== e._backpressure && (t ? cr(n) : ur(n)), e._backpressure = t;
		}
		class U {
			constructor(e) {
				if (A(e, 1, "WritableStreamDefaultWriter"), en(e, "First parameter"), ln(e)) throw TypeError("This stream has already been locked for exclusive writing by another writer");
				this._ownerWritableStream = e, e._writer = this;
				let t = e._state;
				if (t === "writable") !H(e) && e._backpressure ? ir(this) : or(this), Qn(this);
				else if (t === "erroring") ar(this, e._storedError), Qn(this);
				else if (t === "closed") or(this), er(this);
				else {
					let t = e._storedError;
					ar(this, t), $n(this, t);
				}
			}
			get closed() {
				return W(this) ? this._closedPromise : u(G("closed"));
			}
			get desiredSize() {
				if (!W(this)) throw G("desiredSize");
				if (this._ownerWritableStream === void 0) throw Zn("desiredSize");
				return An(this);
			}
			get ready() {
				return W(this) ? this._readyPromise : u(G("ready"));
			}
			abort(e = void 0) {
				return W(this) ? this._ownerWritableStream === void 0 ? u(Zn("abort")) : Tn(this, e) : u(G("abort"));
			}
			close() {
				if (!W(this)) return u(G("close"));
				let e = this._ownerWritableStream;
				return e === void 0 ? u(Zn("close")) : H(e) ? u(/* @__PURE__ */ TypeError("Cannot close an already-closing stream")) : En(this);
			}
			releaseLock() {
				if (!W(this)) throw G("releaseLock");
				this._ownerWritableStream !== void 0 && jn(this);
			}
			write(e = void 0) {
				return W(this) ? this._ownerWritableStream === void 0 ? u(Zn("write to")) : Mn(this, e) : u(G("write"));
			}
		}
		Object.defineProperties(U.prototype, {
			abort: { enumerable: !0 },
			close: { enumerable: !0 },
			releaseLock: { enumerable: !0 },
			write: { enumerable: !0 },
			closed: { enumerable: !0 },
			desiredSize: { enumerable: !0 },
			ready: { enumerable: !0 }
		}), i(U.prototype.abort, "abort"), i(U.prototype.close, "close"), i(U.prototype.releaseLock, "releaseLock"), i(U.prototype.write, "write"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(U.prototype, Symbol.toStringTag, {
			value: "WritableStreamDefaultWriter",
			configurable: !0
		});
		function W(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_ownerWritableStream") ? !1 : e instanceof U;
		}
		function Tn(e, t) {
			let n = e._ownerWritableStream;
			return un(n, t);
		}
		function En(e) {
			let t = e._ownerWritableStream;
			return dn(t);
		}
		function Dn(e) {
			let t = e._ownerWritableStream, n = t._state;
			return H(t) || n === "closed" ? l(void 0) : n === "errored" ? u(t._storedError) : En(e);
		}
		function On(e, t) {
			e._closedPromiseState === "pending" ? tr(e, t) : nr(e, t);
		}
		function kn(e, t) {
			e._readyPromiseState === "pending" ? sr(e, t) : lr(e, t);
		}
		function An(e) {
			let t = e._ownerWritableStream, n = t._state;
			return n === "errored" || n === "erroring" ? null : n === "closed" ? 0 : Vn(t._writableStreamController);
		}
		function jn(e) {
			let t = e._ownerWritableStream, n = /* @__PURE__ */ TypeError("Writer was released and can no longer be used to monitor the stream's closedness");
			kn(e, n), On(e, n), t._writer = void 0, e._ownerWritableStream = void 0;
		}
		function Mn(e, t) {
			let n = e._ownerWritableStream, r = n._writableStreamController, i = Bn(r, t);
			if (n !== e._ownerWritableStream) return u(Zn("write to"));
			let a = n._state;
			if (a === "errored") return u(n._storedError);
			if (H(n) || a === "closed") return u(/* @__PURE__ */ TypeError("The stream is closing or closed and cannot be written to"));
			if (a === "erroring") return u(n._storedError);
			let o = fn(n);
			return Hn(r, t, i), o;
		}
		let Nn = {};
		class Pn {
			constructor() {
				throw TypeError("Illegal constructor");
			}
			get abortReason() {
				if (!Fn(this)) throw Xn("abortReason");
				return this._abortReason;
			}
			get signal() {
				if (!Fn(this)) throw Xn("signal");
				if (this._abortController === void 0) throw TypeError("WritableStreamDefaultController.prototype.signal is not supported");
				return this._abortController.signal;
			}
			error(e = void 0) {
				if (!Fn(this)) throw Xn("error");
				this._controlledWritableStream._state === "writable" && Jn(this, e);
			}
			[x](e) {
				let t = this._abortAlgorithm(e);
				return Rn(this), t;
			}
			[ee]() {
				F(this);
			}
		}
		Object.defineProperties(Pn.prototype, {
			abortReason: { enumerable: !0 },
			signal: { enumerable: !0 },
			error: { enumerable: !0 }
		}), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(Pn.prototype, Symbol.toStringTag, {
			value: "WritableStreamDefaultController",
			configurable: !0
		});
		function Fn(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_controlledWritableStream") ? !1 : e instanceof Pn;
		}
		function In(e, t, n, r, i, a, o, s) {
			t._controlledWritableStream = e, e._writableStreamController = t, t._queue = void 0, t._queueTotalSize = void 0, F(t), t._abortReason = void 0, t._abortController = rn(), t._started = !1, t._strategySizeAlgorithm = s, t._strategyHWM = o, t._writeAlgorithm = r, t._closeAlgorithm = i, t._abortAlgorithm = a, wn(e, qn(t)), f(l(n()), () => (t._started = !0, Un(t), null), (n) => (t._started = !0, pn(e, n), null));
		}
		function Ln(e, t, n, r) {
			let i = Object.create(Pn.prototype), a, o, s, c;
			a = t.start === void 0 ? () => void 0 : () => t.start(i), o = t.write === void 0 ? () => l(void 0) : (e) => t.write(e, i), s = t.close === void 0 ? () => l(void 0) : () => t.close(), c = t.abort === void 0 ? () => l(void 0) : (e) => t.abort(e), In(e, i, a, o, s, c, n, r);
		}
		function Rn(e) {
			e._writeAlgorithm = void 0, e._closeAlgorithm = void 0, e._abortAlgorithm = void 0, e._strategySizeAlgorithm = void 0;
		}
		function zn(e) {
			Je(e, Nn, 0), Un(e);
		}
		function Bn(e, t) {
			try {
				return e._strategySizeAlgorithm(t);
			} catch (t) {
				return Wn(e, t), 1;
			}
		}
		function Vn(e) {
			return e._strategyHWM - e._queueTotalSize;
		}
		function Hn(e, t, n) {
			try {
				Je(e, t, n);
			} catch (t) {
				Wn(e, t);
				return;
			}
			let r = e._controlledWritableStream;
			!H(r) && r._state === "writable" && wn(r, qn(e)), Un(e);
		}
		function Un(e) {
			let t = e._controlledWritableStream;
			if (!e._started || t._inFlightWriteRequest !== void 0) return;
			if (t._state === "erroring") {
				hn(t);
				return;
			}
			if (e._queue.length === 0) return;
			let n = Ye(e);
			n === Nn ? Gn(e) : Kn(e, n);
		}
		function Wn(e, t) {
			e._controlledWritableStream._state === "writable" && Jn(e, t);
		}
		function Gn(e) {
			let t = e._controlledWritableStream;
			xn(t), qe(e);
			let n = e._closeAlgorithm();
			Rn(e), f(n, () => (vn(t), null), (e) => (yn(t, e), null));
		}
		function Kn(e, t) {
			let n = e._controlledWritableStream;
			Sn(n), f(e._writeAlgorithm(t), () => {
				gn(n);
				let t = n._state;
				if (qe(e), !H(n) && t === "writable") {
					let t = qn(e);
					wn(n, t);
				}
				return Un(e), null;
			}, (t) => (n._state === "writable" && Rn(e), _n(n, t), null));
		}
		function qn(e) {
			return Vn(e) <= 0;
		}
		function Jn(e, t) {
			let n = e._controlledWritableStream;
			Rn(e), mn(n, t);
		}
		function Yn(e) {
			return /* @__PURE__ */ TypeError(`WritableStream.prototype.${e} can only be used on a WritableStream`);
		}
		function Xn(e) {
			return /* @__PURE__ */ TypeError(`WritableStreamDefaultController.prototype.${e} can only be used on a WritableStreamDefaultController`);
		}
		function G(e) {
			return /* @__PURE__ */ TypeError(`WritableStreamDefaultWriter.prototype.${e} can only be used on a WritableStreamDefaultWriter`);
		}
		function Zn(e) {
			return /* @__PURE__ */ TypeError("Cannot " + e + " a stream using a released writer");
		}
		function Qn(e) {
			e._closedPromise = c((t, n) => {
				e._closedPromise_resolve = t, e._closedPromise_reject = n, e._closedPromiseState = "pending";
			});
		}
		function $n(e, t) {
			Qn(e), tr(e, t);
		}
		function er(e) {
			Qn(e), rr(e);
		}
		function tr(e, t) {
			e._closedPromise_reject !== void 0 && (g(e._closedPromise), e._closedPromise_reject(t), e._closedPromise_resolve = void 0, e._closedPromise_reject = void 0, e._closedPromiseState = "rejected");
		}
		function nr(e, t) {
			$n(e, t);
		}
		function rr(e) {
			e._closedPromise_resolve !== void 0 && (e._closedPromise_resolve(void 0), e._closedPromise_resolve = void 0, e._closedPromise_reject = void 0, e._closedPromiseState = "resolved");
		}
		function ir(e) {
			e._readyPromise = c((t, n) => {
				e._readyPromise_resolve = t, e._readyPromise_reject = n;
			}), e._readyPromiseState = "pending";
		}
		function ar(e, t) {
			ir(e), sr(e, t);
		}
		function or(e) {
			ir(e), ur(e);
		}
		function sr(e, t) {
			e._readyPromise_reject !== void 0 && (g(e._readyPromise), e._readyPromise_reject(t), e._readyPromise_resolve = void 0, e._readyPromise_reject = void 0, e._readyPromiseState = "rejected");
		}
		function cr(e) {
			ir(e);
		}
		function lr(e, t) {
			ar(e, t);
		}
		function ur(e) {
			e._readyPromise_resolve !== void 0 && (e._readyPromise_resolve(void 0), e._readyPromise_resolve = void 0, e._readyPromise_reject = void 0, e._readyPromiseState = "fulfilled");
		}
		function dr() {
			if (typeof globalThis < "u") return globalThis;
			if (typeof self < "u") return self;
			if (typeof global < "u") return global;
		}
		let fr = dr();
		function pr(e) {
			if (typeof e != "function" && typeof e != "object" || e.name !== "DOMException") return !1;
			try {
				return new e(), !0;
			} catch {
				return !1;
			}
		}
		function mr() {
			let e = fr?.DOMException;
			return pr(e) ? e : void 0;
		}
		function hr() {
			let e = function(e, t) {
				this.message = e || "", this.name = t || "Error", Error.captureStackTrace && Error.captureStackTrace(this, this.constructor);
			};
			return i(e, "DOMException"), e.prototype = Object.create(Error.prototype), Object.defineProperty(e.prototype, "constructor", {
				value: e,
				writable: !0,
				configurable: !0
			}), e;
		}
		let gr = mr() || hr();
		function _r(e, n, r, i, a, o) {
			let s = ye(e), u = an(n);
			e._disturbed = !0;
			let h = !1, _ = l(void 0);
			return c((v, y) => {
				let b;
				if (o !== void 0) {
					if (b = () => {
						let t = o.reason === void 0 ? new gr("Aborted", "AbortError") : o.reason, r = [];
						i || r.push(() => n._state === "writable" ? un(n, t) : l(void 0)), a || r.push(() => e._state === "readable" ? Q(e, t) : l(void 0)), w(() => Promise.all(r.map((e) => e())), !0, t);
					}, o.aborted) {
						b();
						return;
					}
					o.addEventListener("abort", b);
				}
				function x() {
					return c((e, t) => {
						function n(r) {
							r ? e() : d(ee(), n, t);
						}
						n(!1);
					});
				}
				function ee() {
					return h ? l(!0) : d(u._readyPromise, () => c((e, n) => {
						we(s, {
							_chunkSteps: (n) => {
								_ = d(Mn(u, n), void 0, t), e(!1);
							},
							_closeSteps: () => e(!0),
							_errorSteps: n
						});
					}));
				}
				if (C(e, s._closedPromise, (e) => (i ? T(!0, e) : w(() => un(n, e), !0, e), null)), C(n, u._closedPromise, (t) => (a ? T(!0, t) : w(() => Q(e, t), !0, t), null)), te(e, s._closedPromise, () => (r ? T() : w(() => Dn(u)), null)), H(n) || n._state === "closed") {
					let t = /* @__PURE__ */ TypeError("the destination writable stream closed before all data could be piped to it");
					a ? T(!0, t) : w(() => Q(e, t), !0, t);
				}
				g(x());
				function S() {
					let e = _;
					return d(_, () => e === _ ? void 0 : S());
				}
				function C(e, t, n) {
					e._state === "errored" ? n(e._storedError) : m(t, n);
				}
				function te(e, t, n) {
					e._state === "closed" ? n() : p(t, n);
				}
				function w(e, t, r) {
					if (h) return;
					h = !0, n._state === "writable" && !H(n) ? p(S(), i) : i();
					function i() {
						return f(e(), () => D(t, r), (e) => D(!0, e)), null;
					}
				}
				function T(e, t) {
					h || (h = !0, n._state === "writable" && !H(n) ? p(S(), () => D(e, t)) : D(e, t));
				}
				function D(e, t) {
					return jn(u), E(s), o !== void 0 && o.removeEventListener("abort", b), e ? y(t) : v(void 0), null;
				}
			});
		}
		class K {
			constructor() {
				throw TypeError("Illegal constructor");
			}
			get desiredSize() {
				if (!vr(this)) throw Or("desiredSize");
				return Cr(this);
			}
			close() {
				if (!vr(this)) throw Or("close");
				if (!Tr(this)) throw TypeError("The stream is not in a state that permits close");
				q(this);
			}
			enqueue(e = void 0) {
				if (!vr(this)) throw Or("enqueue");
				if (!Tr(this)) throw TypeError("The stream is not in a state that permits enqueue");
				return Sr(this, e);
			}
			error(e = void 0) {
				if (!vr(this)) throw Or("error");
				J(this, e);
			}
			[S](e) {
				F(this);
				let t = this._cancelAlgorithm(e);
				return xr(this), t;
			}
			[C](e) {
				let t = this._controlledReadableStream;
				if (this._queue.length > 0) {
					let n = qe(this);
					this._closeRequested && this._queue.length === 0 ? (xr(this), Jr(t)) : yr(this), e._chunkSteps(n);
				} else be(t, e), yr(this);
			}
			[te]() {}
		}
		Object.defineProperties(K.prototype, {
			close: { enumerable: !0 },
			enqueue: { enumerable: !0 },
			error: { enumerable: !0 },
			desiredSize: { enumerable: !0 }
		}), i(K.prototype.close, "close"), i(K.prototype.enqueue, "enqueue"), i(K.prototype.error, "error"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(K.prototype, Symbol.toStringTag, {
			value: "ReadableStreamDefaultController",
			configurable: !0
		});
		function vr(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_controlledReadableStream") ? !1 : e instanceof K;
		}
		function yr(e) {
			if (br(e)) {
				if (e._pulling) {
					e._pullAgain = !0;
					return;
				}
				e._pulling = !0, f(e._pullAlgorithm(), () => (e._pulling = !1, e._pullAgain && (e._pullAgain = !1, yr(e)), null), (t) => (J(e, t), null));
			}
		}
		function br(e) {
			let t = e._controlledReadableStream;
			return !Tr(e) || !e._started ? !1 : !!(Z(t) && Se(t) > 0 || Cr(e) > 0);
		}
		function xr(e) {
			e._pullAlgorithm = void 0, e._cancelAlgorithm = void 0, e._strategySizeAlgorithm = void 0;
		}
		function q(e) {
			if (!Tr(e)) return;
			let t = e._controlledReadableStream;
			e._closeRequested = !0, e._queue.length === 0 && (xr(e), Jr(t));
		}
		function Sr(e, t) {
			if (!Tr(e)) return;
			let n = e._controlledReadableStream;
			if (Z(n) && Se(n) > 0) xe(n, t, !1);
			else {
				let n;
				try {
					n = e._strategySizeAlgorithm(t);
				} catch (t) {
					throw J(e, t), t;
				}
				try {
					Je(e, t, n);
				} catch (t) {
					throw J(e, t), t;
				}
			}
			yr(e);
		}
		function J(e, t) {
			let n = e._controlledReadableStream;
			n._state === "readable" && (F(e), xr(e), Yr(n, t));
		}
		function Cr(e) {
			let t = e._controlledReadableStream._state;
			return t === "errored" ? null : t === "closed" ? 0 : e._strategyHWM - e._queueTotalSize;
		}
		function wr(e) {
			return !br(e);
		}
		function Tr(e) {
			let t = e._controlledReadableStream._state;
			return !e._closeRequested && t === "readable";
		}
		function Er(e, t, n, r, i, a, o) {
			t._controlledReadableStream = e, t._queue = void 0, t._queueTotalSize = void 0, F(t), t._started = !1, t._closeRequested = !1, t._pullAgain = !1, t._pulling = !1, t._strategySizeAlgorithm = o, t._strategyHWM = a, t._pullAlgorithm = r, t._cancelAlgorithm = i, e._readableStreamController = t, f(l(n()), () => (t._started = !0, yr(t), null), (e) => (J(t, e), null));
		}
		function Dr(e, t, n, r) {
			let i = Object.create(K.prototype), a, o, s;
			a = t.start === void 0 ? () => void 0 : () => t.start(i), o = t.pull === void 0 ? () => l(void 0) : () => t.pull(i), s = t.cancel === void 0 ? () => l(void 0) : (e) => t.cancel(e), Er(e, i, a, o, s, n, r);
		}
		function Or(e) {
			return /* @__PURE__ */ TypeError(`ReadableStreamDefaultController.prototype.${e} can only be used on a ReadableStreamDefaultController`);
		}
		function kr(e, t) {
			return $e(e._readableStreamController) ? jr(e) : Ar(e);
		}
		function Ar(e, t) {
			let n = ye(e), r = !1, i = !1, a = !1, o = !1, s, u, d, f, p, h = c((e) => {
				p = e;
			});
			function g() {
				return r ? (i = !0, l(void 0)) : (r = !0, we(n, {
					_chunkSteps: (e) => {
						_(() => {
							i = !1;
							let t = e, n = e;
							a || Sr(d._readableStreamController, t), o || Sr(f._readableStreamController, n), r = !1, i && g();
						});
					},
					_closeSteps: () => {
						r = !1, a || q(d._readableStreamController), o || q(f._readableStreamController), (!a || !o) && p(void 0);
					},
					_errorSteps: () => {
						r = !1;
					}
				}), l(void 0));
			}
			function v(t) {
				if (a = !0, s = t, o) {
					let t = Q(e, Fe([s, u]));
					p(t);
				}
				return h;
			}
			function y(t) {
				if (o = !0, u = t, a) {
					let t = Q(e, Fe([s, u]));
					p(t);
				}
				return h;
			}
			function b() {}
			return d = Gr(b, g, v), f = Gr(b, g, y), m(n._closedPromise, (e) => (J(d._readableStreamController, e), J(f._readableStreamController, e), (!a || !o) && p(void 0), null)), [d, f];
		}
		function jr(e) {
			let t = ye(e), n = !1, r = !1, i = !1, a = !1, o = !1, s, u, d, f, p, h = c((e) => {
				p = e;
			});
			function g(e) {
				m(e._closedPromise, (n) => e === t ? (R(d._readableStreamController, n), R(f._readableStreamController, n), (!a || !o) && p(void 0), null) : null);
			}
			function v() {
				B(t) && (E(t), t = ye(e), g(t)), we(t, {
					_chunkSteps: (t) => {
						_(() => {
							r = !1, i = !1;
							let s = t, c = t;
							if (!a && !o) try {
								c = Ke(t);
							} catch (t) {
								R(d._readableStreamController, t), R(f._readableStreamController, t), p(Q(e, t));
								return;
							}
							a || St(d._readableStreamController, s), o || St(f._readableStreamController, c), n = !1, r ? b() : i && x();
						});
					},
					_closeSteps: () => {
						n = !1, a || xt(d._readableStreamController), o || xt(f._readableStreamController), d._readableStreamController._pendingPullIntos.length > 0 && Et(d._readableStreamController, 0), f._readableStreamController._pendingPullIntos.length > 0 && Et(f._readableStreamController, 0), (!a || !o) && p(void 0);
					},
					_errorSteps: () => {
						n = !1;
					}
				});
			}
			function y(s, c) {
				M(t) && (E(t), t = It(e), g(t));
				let l = c ? f : d, u = c ? d : f;
				Vt(t, s, 1, {
					_chunkSteps: (t) => {
						_(() => {
							r = !1, i = !1;
							let s = c ? o : a;
							if (c ? a : o) s || Dt(l._readableStreamController, t);
							else {
								let n;
								try {
									n = Ke(t);
								} catch (t) {
									R(l._readableStreamController, t), R(u._readableStreamController, t), p(Q(e, t));
									return;
								}
								s || Dt(l._readableStreamController, t), St(u._readableStreamController, n);
							}
							n = !1, r ? b() : i && x();
						});
					},
					_closeSteps: (e) => {
						n = !1;
						let t = c ? o : a, r = c ? a : o;
						t || xt(l._readableStreamController), r || xt(u._readableStreamController), e !== void 0 && (t || Dt(l._readableStreamController, e), !r && u._readableStreamController._pendingPullIntos.length > 0 && Et(u._readableStreamController, 0)), (!t || !r) && p(void 0);
					},
					_errorSteps: () => {
						n = !1;
					}
				});
			}
			function b() {
				if (n) return r = !0, l(void 0);
				n = !0;
				let e = wt(d._readableStreamController);
				return e === null ? v() : y(e._view, !1), l(void 0);
			}
			function x() {
				if (n) return i = !0, l(void 0);
				n = !0;
				let e = wt(f._readableStreamController);
				return e === null ? v() : y(e._view, !0), l(void 0);
			}
			function ee(t) {
				if (a = !0, s = t, o) {
					let t = Q(e, Fe([s, u]));
					p(t);
				}
				return h;
			}
			function S(t) {
				if (o = !0, u = t, a) {
					let t = Q(e, Fe([s, u]));
					p(t);
				}
				return h;
			}
			function C() {}
			return d = Kr(C, b, ee), f = Kr(C, x, S), g(t), [d, f];
		}
		function Mr(e) {
			return n(e) && e.getReader !== void 0;
		}
		function Nr(e) {
			return Mr(e) ? Fr(e.getReader()) : Pr(e);
		}
		function Pr(e) {
			let r, i = Ve(e, "async"), a = t;
			function o() {
				let e;
				try {
					e = He(i);
				} catch (e) {
					return u(e);
				}
				return h(l(e), (e) => {
					if (!n(e)) throw TypeError("The promise returned by the iterator.next() method must fulfill with an object");
					if (Ue(e)) q(r._readableStreamController);
					else {
						let t = We(e);
						Sr(r._readableStreamController, t);
					}
				});
			}
			function s(e) {
				let t = i.iterator, r;
				try {
					r = Re(t, "return");
				} catch (e) {
					return u(e);
				}
				if (r === void 0) return l(void 0);
				let a;
				try {
					a = v(r, t, [e]);
				} catch (e) {
					return u(e);
				}
				return h(l(a), (e) => {
					if (!n(e)) throw TypeError("The promise returned by the iterator.return() method must fulfill with an object");
				});
			}
			return r = Gr(a, o, s, 0), r;
		}
		function Fr(e) {
			let r, i = t;
			function a() {
				let t;
				try {
					t = e.read();
				} catch (e) {
					return u(e);
				}
				return h(t, (e) => {
					if (!n(e)) throw TypeError("The promise returned by the reader.read() method must fulfill with an object");
					if (e.done) q(r._readableStreamController);
					else {
						let t = e.value;
						Sr(r._readableStreamController, t);
					}
				});
			}
			function o(t) {
				try {
					return l(e.cancel(t));
				} catch (e) {
					return u(e);
				}
			}
			return r = Gr(i, a, o, 0), r;
		}
		function Ir(e, t) {
			O(e, t);
			let n = e, r = n?.autoAllocateChunkSize, i = n?.cancel, a = n?.pull, o = n?.start, s = n?.type;
			return {
				autoAllocateChunkSize: r === void 0 ? void 0 : _e(r, `${t} has member 'autoAllocateChunkSize' that`),
				cancel: i === void 0 ? void 0 : Lr(i, n, `${t} has member 'cancel' that`),
				pull: a === void 0 ? void 0 : Rr(a, n, `${t} has member 'pull' that`),
				start: o === void 0 ? void 0 : zr(o, n, `${t} has member 'start' that`),
				type: s === void 0 ? void 0 : Br(s, `${t} has member 'type' that`)
			};
		}
		function Lr(e, t, n) {
			return k(e, n), (n) => y(e, t, [n]);
		}
		function Rr(e, t, n) {
			return k(e, n), (n) => y(e, t, [n]);
		}
		function zr(e, t, n) {
			return k(e, n), (n) => v(e, t, [n]);
		}
		function Br(e, t) {
			if (e = `${e}`, e !== "bytes") throw TypeError(`${t} '${e}' is not a valid enumeration value for ReadableStreamType`);
			return e;
		}
		function Vr(e, t) {
			return O(e, t), { preventCancel: !!e?.preventCancel };
		}
		function Hr(e, t) {
			O(e, t);
			let n = e?.preventAbort, r = e?.preventCancel, i = e?.preventClose, a = e?.signal;
			return a !== void 0 && Ur(a, `${t} has member 'signal' that`), {
				preventAbort: !!n,
				preventCancel: !!r,
				preventClose: !!i,
				signal: a
			};
		}
		function Ur(e, t) {
			if (!tn(e)) throw TypeError(`${t} is not an AbortSignal.`);
		}
		function Wr(e, t) {
			O(e, t);
			let n = e?.readable;
			pe(n, "readable", "ReadableWritablePair"), ve(n, `${t} has member 'readable' that`);
			let r = e?.writable;
			return pe(r, "writable", "ReadableWritablePair"), en(r, `${t} has member 'writable' that`), {
				readable: n,
				writable: r
			};
		}
		class Y {
			constructor(e = {}, t = {}) {
				e === void 0 ? e = null : fe(e, "First parameter");
				let n = qt(t, "Second parameter"), r = Ir(e, "First parameter");
				if (qr(this), r.type === "bytes") {
					if (n.size !== void 0) throw RangeError("The strategy for a byte stream cannot have a size function");
					let e = Gt(n, 0);
					kt(this, r, e);
				} else {
					let e = Kt(n), t = Gt(n, 1);
					Dr(this, r, t, e);
				}
			}
			get locked() {
				if (!X(this)) throw Xr("locked");
				return Z(this);
			}
			cancel(e = void 0) {
				return X(this) ? Z(this) ? u(/* @__PURE__ */ TypeError("Cannot cancel a stream that already has a reader")) : Q(this, e) : u(Xr("cancel"));
			}
			getReader(e = void 0) {
				if (!X(this)) throw Xr("getReader");
				return Nt(e, "First parameter").mode === void 0 ? ye(this) : It(this);
			}
			pipeThrough(e, t = {}) {
				if (!X(this)) throw Xr("pipeThrough");
				A(e, 1, "pipeThrough");
				let n = Wr(e, "First parameter"), r = Hr(t, "Second parameter");
				if (Z(this)) throw TypeError("ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream");
				if (ln(n.writable)) throw TypeError("ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream");
				return g(_r(this, n.writable, r.preventClose, r.preventAbort, r.preventCancel, r.signal)), n.readable;
			}
			pipeTo(e, t = {}) {
				if (!X(this)) return u(Xr("pipeTo"));
				if (e === void 0) return u("Parameter 1 is required in 'pipeTo'.");
				if (!cn(e)) return u(/* @__PURE__ */ TypeError("ReadableStream.prototype.pipeTo's first argument must be a WritableStream"));
				let n;
				try {
					n = Hr(t, "Second parameter");
				} catch (e) {
					return u(e);
				}
				return Z(this) ? u(/* @__PURE__ */ TypeError("ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream")) : ln(e) ? u(/* @__PURE__ */ TypeError("ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream")) : _r(this, e, n.preventClose, n.preventAbort, n.preventCancel, n.signal);
			}
			tee() {
				if (!X(this)) throw Xr("tee");
				return Fe(kr(this));
			}
			values(e = void 0) {
				if (!X(this)) throw Xr("values");
				let t = Vr(e, "First parameter");
				return je(this, t.preventCancel);
			}
			[Be](e) {
				return this.values(e);
			}
			static from(e) {
				return Nr(e);
			}
		}
		Object.defineProperties(Y, { from: { enumerable: !0 } }), Object.defineProperties(Y.prototype, {
			cancel: { enumerable: !0 },
			getReader: { enumerable: !0 },
			pipeThrough: { enumerable: !0 },
			pipeTo: { enumerable: !0 },
			tee: { enumerable: !0 },
			values: { enumerable: !0 },
			locked: { enumerable: !0 }
		}), i(Y.from, "from"), i(Y.prototype.cancel, "cancel"), i(Y.prototype.getReader, "getReader"), i(Y.prototype.pipeThrough, "pipeThrough"), i(Y.prototype.pipeTo, "pipeTo"), i(Y.prototype.tee, "tee"), i(Y.prototype.values, "values"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(Y.prototype, Symbol.toStringTag, {
			value: "ReadableStream",
			configurable: !0
		}), Object.defineProperty(Y.prototype, Be, {
			value: Y.prototype.values,
			writable: !0,
			configurable: !0
		});
		function Gr(e, t, n, r = 1, i = () => 1) {
			let a = Object.create(Y.prototype);
			return qr(a), Er(a, Object.create(K.prototype), e, t, n, r, i), a;
		}
		function Kr(e, t, n) {
			let r = Object.create(Y.prototype);
			return qr(r), Ot(r, Object.create(L.prototype), e, t, n, 0, void 0), r;
		}
		function qr(e) {
			e._state = "readable", e._reader = void 0, e._storedError = void 0, e._disturbed = !1;
		}
		function X(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_readableStreamController") ? !1 : e instanceof Y;
		}
		function Z(e) {
			return e._reader !== void 0;
		}
		function Q(e, n) {
			if (e._disturbed = !0, e._state === "closed") return l(void 0);
			if (e._state === "errored") return u(e._storedError);
			Jr(e);
			let r = e._reader;
			if (r !== void 0 && B(r)) {
				let e = r._readIntoRequests;
				r._readIntoRequests = new b(), e.forEach((e) => {
					e._closeSteps(void 0);
				});
			}
			return h(e._readableStreamController[S](n), t);
		}
		function Jr(e) {
			e._state = "closed";
			let t = e._reader;
			if (t !== void 0 && (se(t), M(t))) {
				let e = t._readRequests;
				t._readRequests = new b(), e.forEach((e) => {
					e._closeSteps();
				});
			}
		}
		function Yr(e, t) {
			e._state = "errored", e._storedError = t;
			let n = e._reader;
			n !== void 0 && (ae(n, t), M(n) ? Ee(n, t) : Ut(n, t));
		}
		function Xr(e) {
			return /* @__PURE__ */ TypeError(`ReadableStream.prototype.${e} can only be used on a ReadableStream`);
		}
		function Zr(e, t) {
			O(e, t);
			let n = e?.highWaterMark;
			return pe(n, "highWaterMark", "QueuingStrategyInit"), { highWaterMark: me(n) };
		}
		let Qr = (e) => e.byteLength;
		i(Qr, "size");
		class $r {
			constructor(e) {
				A(e, 1, "ByteLengthQueuingStrategy"), e = Zr(e, "First parameter"), this._byteLengthQueuingStrategyHighWaterMark = e.highWaterMark;
			}
			get highWaterMark() {
				if (!ti(this)) throw ei("highWaterMark");
				return this._byteLengthQueuingStrategyHighWaterMark;
			}
			get size() {
				if (!ti(this)) throw ei("size");
				return Qr;
			}
		}
		Object.defineProperties($r.prototype, {
			highWaterMark: { enumerable: !0 },
			size: { enumerable: !0 }
		}), typeof Symbol.toStringTag == "symbol" && Object.defineProperty($r.prototype, Symbol.toStringTag, {
			value: "ByteLengthQueuingStrategy",
			configurable: !0
		});
		function ei(e) {
			return /* @__PURE__ */ TypeError(`ByteLengthQueuingStrategy.prototype.${e} can only be used on a ByteLengthQueuingStrategy`);
		}
		function ti(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_byteLengthQueuingStrategyHighWaterMark") ? !1 : e instanceof $r;
		}
		let ni = () => 1;
		i(ni, "size");
		class ri {
			constructor(e) {
				A(e, 1, "CountQueuingStrategy"), e = Zr(e, "First parameter"), this._countQueuingStrategyHighWaterMark = e.highWaterMark;
			}
			get highWaterMark() {
				if (!ai(this)) throw ii("highWaterMark");
				return this._countQueuingStrategyHighWaterMark;
			}
			get size() {
				if (!ai(this)) throw ii("size");
				return ni;
			}
		}
		Object.defineProperties(ri.prototype, {
			highWaterMark: { enumerable: !0 },
			size: { enumerable: !0 }
		}), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(ri.prototype, Symbol.toStringTag, {
			value: "CountQueuingStrategy",
			configurable: !0
		});
		function ii(e) {
			return /* @__PURE__ */ TypeError(`CountQueuingStrategy.prototype.${e} can only be used on a CountQueuingStrategy`);
		}
		function ai(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_countQueuingStrategyHighWaterMark") ? !1 : e instanceof ri;
		}
		function oi(e, t) {
			O(e, t);
			let n = e?.cancel, r = e?.flush, i = e?.readableType, a = e?.start, o = e?.transform, s = e?.writableType;
			return {
				cancel: n === void 0 ? void 0 : ui(n, e, `${t} has member 'cancel' that`),
				flush: r === void 0 ? void 0 : si(r, e, `${t} has member 'flush' that`),
				readableType: i,
				start: a === void 0 ? void 0 : ci(a, e, `${t} has member 'start' that`),
				transform: o === void 0 ? void 0 : li(o, e, `${t} has member 'transform' that`),
				writableType: s
			};
		}
		function si(e, t, n) {
			return k(e, n), (n) => y(e, t, [n]);
		}
		function ci(e, t, n) {
			return k(e, n), (n) => v(e, t, [n]);
		}
		function li(e, t, n) {
			return k(e, n), (n, r) => y(e, t, [n, r]);
		}
		function ui(e, t, n) {
			return k(e, n), (n) => y(e, t, [n]);
		}
		class di {
			constructor(e = {}, t = {}, n = {}) {
				e === void 0 && (e = null);
				let r = qt(t, "Second parameter"), i = qt(n, "Third parameter"), a = oi(e, "First parameter");
				if (a.readableType !== void 0) throw RangeError("Invalid readableType specified");
				if (a.writableType !== void 0) throw RangeError("Invalid writableType specified");
				let o = Gt(i, 0), s = Kt(i), l = Gt(r, 1), u = Kt(r), d, f = c((e) => {
					d = e;
				});
				fi(this, f, l, u, o, s), bi(this, a), a.start === void 0 ? d(void 0) : d(a.start(this._transformStreamController));
			}
			get readable() {
				if (!pi(this)) throw Pi("readable");
				return this._readable;
			}
			get writable() {
				if (!pi(this)) throw Pi("writable");
				return this._writable;
			}
		}
		Object.defineProperties(di.prototype, {
			readable: { enumerable: !0 },
			writable: { enumerable: !0 }
		}), typeof Symbol.toStringTag == "symbol" && Object.defineProperty(di.prototype, Symbol.toStringTag, {
			value: "TransformStream",
			configurable: !0
		});
		function fi(e, t, n, r, i, a) {
			function o() {
				return t;
			}
			function s(t) {
				return Ei(e, t);
			}
			function c(t) {
				return Di(e, t);
			}
			function l() {
				return Oi(e);
			}
			e._writable = on(o, s, l, c, n, r);
			function u() {
				return ki(e);
			}
			function d(t) {
				return Ai(e, t);
			}
			e._readable = Gr(o, u, d, i, a), e._backpressure = void 0, e._backpressureChangePromise = void 0, e._backpressureChangePromise_resolve = void 0, _i(e, !0), e._transformStreamController = void 0;
		}
		function pi(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_transformStreamController") ? !1 : e instanceof di;
		}
		function mi(e, t) {
			J(e._readable._readableStreamController, t), hi(e, t);
		}
		function hi(e, t) {
			xi(e._transformStreamController), Wn(e._writable._writableStreamController, t), gi(e);
		}
		function gi(e) {
			e._backpressure && _i(e, !1);
		}
		function _i(e, t) {
			e._backpressureChangePromise !== void 0 && e._backpressureChangePromise_resolve(), e._backpressureChangePromise = c((t) => {
				e._backpressureChangePromise_resolve = t;
			}), e._backpressure = t;
		}
		class $ {
			constructor() {
				throw TypeError("Illegal constructor");
			}
			get desiredSize() {
				if (!vi(this)) throw ji("desiredSize");
				let e = this._controlledTransformStream._readable._readableStreamController;
				return Cr(e);
			}
			enqueue(e = void 0) {
				if (!vi(this)) throw ji("enqueue");
				Si(this, e);
			}
			error(e = void 0) {
				if (!vi(this)) throw ji("error");
				Ci(this, e);
			}
			terminate() {
				if (!vi(this)) throw ji("terminate");
				Ti(this);
			}
		}
		Object.defineProperties($.prototype, {
			enqueue: { enumerable: !0 },
			error: { enumerable: !0 },
			terminate: { enumerable: !0 },
			desiredSize: { enumerable: !0 }
		}), i($.prototype.enqueue, "enqueue"), i($.prototype.error, "error"), i($.prototype.terminate, "terminate"), typeof Symbol.toStringTag == "symbol" && Object.defineProperty($.prototype, Symbol.toStringTag, {
			value: "TransformStreamDefaultController",
			configurable: !0
		});
		function vi(e) {
			return !n(e) || !Object.prototype.hasOwnProperty.call(e, "_controlledTransformStream") ? !1 : e instanceof $;
		}
		function yi(e, t, n, r, i) {
			t._controlledTransformStream = e, e._transformStreamController = t, t._transformAlgorithm = n, t._flushAlgorithm = r, t._cancelAlgorithm = i, t._finishPromise = void 0, t._finishPromise_resolve = void 0, t._finishPromise_reject = void 0;
		}
		function bi(e, t) {
			let n = Object.create($.prototype), r, i, a;
			r = t.transform === void 0 ? (e) => {
				try {
					return Si(n, e), l(void 0);
				} catch (e) {
					return u(e);
				}
			} : (e) => t.transform(e, n), i = t.flush === void 0 ? () => l(void 0) : () => t.flush(n), a = t.cancel === void 0 ? () => l(void 0) : (e) => t.cancel(e), yi(e, n, r, i, a);
		}
		function xi(e) {
			e._transformAlgorithm = void 0, e._flushAlgorithm = void 0, e._cancelAlgorithm = void 0;
		}
		function Si(e, t) {
			let n = e._controlledTransformStream, r = n._readable._readableStreamController;
			if (!Tr(r)) throw TypeError("Readable side is not in a state that permits enqueue");
			try {
				Sr(r, t);
			} catch (e) {
				throw hi(n, e), n._readable._storedError;
			}
			wr(r) !== n._backpressure && _i(n, !0);
		}
		function Ci(e, t) {
			mi(e._controlledTransformStream, t);
		}
		function wi(e, t) {
			return h(e._transformAlgorithm(t), void 0, (t) => {
				throw mi(e._controlledTransformStream, t), t;
			});
		}
		function Ti(e) {
			let t = e._controlledTransformStream, n = t._readable._readableStreamController;
			q(n), hi(t, /* @__PURE__ */ TypeError("TransformStream terminated"));
		}
		function Ei(e, t) {
			let n = e._transformStreamController;
			if (e._backpressure) {
				let r = e._backpressureChangePromise;
				return h(r, () => {
					let r = e._writable;
					if (r._state === "erroring") throw r._storedError;
					return wi(n, t);
				});
			}
			return wi(n, t);
		}
		function Di(e, t) {
			let n = e._transformStreamController;
			if (n._finishPromise !== void 0) return n._finishPromise;
			let r = e._readable;
			n._finishPromise = c((e, t) => {
				n._finishPromise_resolve = e, n._finishPromise_reject = t;
			});
			let i = n._cancelAlgorithm(t);
			return xi(n), f(i, () => (r._state === "errored" ? Ni(n, r._storedError) : (J(r._readableStreamController, t), Mi(n)), null), (e) => (J(r._readableStreamController, e), Ni(n, e), null)), n._finishPromise;
		}
		function Oi(e) {
			let t = e._transformStreamController;
			if (t._finishPromise !== void 0) return t._finishPromise;
			let n = e._readable;
			t._finishPromise = c((e, n) => {
				t._finishPromise_resolve = e, t._finishPromise_reject = n;
			});
			let r = t._flushAlgorithm();
			return xi(t), f(r, () => (n._state === "errored" ? Ni(t, n._storedError) : (q(n._readableStreamController), Mi(t)), null), (e) => (J(n._readableStreamController, e), Ni(t, e), null)), t._finishPromise;
		}
		function ki(e) {
			return _i(e, !1), e._backpressureChangePromise;
		}
		function Ai(e, t) {
			let n = e._transformStreamController;
			if (n._finishPromise !== void 0) return n._finishPromise;
			let r = e._writable;
			n._finishPromise = c((e, t) => {
				n._finishPromise_resolve = e, n._finishPromise_reject = t;
			});
			let i = n._cancelAlgorithm(t);
			return xi(n), f(i, () => (r._state === "errored" ? Ni(n, r._storedError) : (Wn(r._writableStreamController, t), gi(e), Mi(n)), null), (t) => (Wn(r._writableStreamController, t), gi(e), Ni(n, t), null)), n._finishPromise;
		}
		function ji(e) {
			return /* @__PURE__ */ TypeError(`TransformStreamDefaultController.prototype.${e} can only be used on a TransformStreamDefaultController`);
		}
		function Mi(e) {
			e._finishPromise_resolve !== void 0 && (e._finishPromise_resolve(), e._finishPromise_resolve = void 0, e._finishPromise_reject = void 0);
		}
		function Ni(e, t) {
			e._finishPromise_reject !== void 0 && (g(e._finishPromise), e._finishPromise_reject(t), e._finishPromise_resolve = void 0, e._finishPromise_reject = void 0);
		}
		function Pi(e) {
			return /* @__PURE__ */ TypeError(`TransformStream.prototype.${e} can only be used on a TransformStream`);
		}
		e.ByteLengthQueuingStrategy = $r, e.CountQueuingStrategy = ri, e.ReadableByteStreamController = L, e.ReadableStream = Y, e.ReadableStreamBYOBReader = z, e.ReadableStreamBYOBRequest = I, e.ReadableStreamDefaultController = K, e.ReadableStreamDefaultReader = j, e.TransformStream = di, e.TransformStreamDefaultController = $, e.WritableStream = V, e.WritableStreamDefaultController = Pn, e.WritableStreamDefaultWriter = U;
	}));
}));
(/* @__PURE__ */ l((() => {
	if (!globalThis.ReadableStream) try {
		let e = m("node:process"), { emitWarning: t } = e;
		try {
			e.emitWarning = () => {}, Object.assign(globalThis, m("node:stream/web")), e.emitWarning = t;
		} catch (n) {
			throw e.emitWarning = t, n;
		}
	} catch {
		Object.assign(globalThis, h());
	}
	try {
		let { Blob: e } = m("buffer");
		e && !e.prototype.stream && (e.prototype.stream = function(e) {
			let t = 0, n = this;
			return new ReadableStream({
				type: "bytes",
				async pull(e) {
					let r = await n.slice(t, Math.min(n.size, t + 65536)).arrayBuffer();
					t += r.byteLength, e.enqueue(new Uint8Array(r)), t === n.size && e.close();
				}
			});
		});
	} catch {}
})))();
var g = 65536;
async function* _(e, t = !0) {
	for (let n of e) if ("stream" in n) yield* n.stream();
	else if (ArrayBuffer.isView(n)) {
		if (t) {
			let e = n.byteOffset, t = n.byteOffset + n.byteLength;
			for (; e !== t;) {
				let r = Math.min(t - e, g), i = n.buffer.slice(e, e + r);
				e += i.byteLength, yield new Uint8Array(i);
			}
		} else yield n;
	} else {
		let e = 0, t = n;
		for (; e !== t.size;) {
			let n = await t.slice(e, Math.min(t.size, e + g)).arrayBuffer();
			e += n.byteLength, yield new Uint8Array(n);
		}
	}
}
var v = class e {
	#e = [];
	#t = "";
	#n = 0;
	#r = "transparent";
	constructor(t = [], n = {}) {
		if (typeof t != "object" || !t) throw TypeError("Failed to construct 'Blob': The provided value cannot be converted to a sequence.");
		if (typeof t[Symbol.iterator] != "function") throw TypeError("Failed to construct 'Blob': The object must have a callable @@iterator property.");
		if (typeof n != "object" && typeof n != "function") throw TypeError("Failed to construct 'Blob': parameter 2 cannot convert to dictionary.");
		n === null && (n = {});
		let r = new TextEncoder();
		for (let n of t) {
			let t;
			t = ArrayBuffer.isView(n) ? new Uint8Array(n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength)) : n instanceof ArrayBuffer ? new Uint8Array(n.slice(0)) : n instanceof e ? n : r.encode(`${n}`), this.#n += ArrayBuffer.isView(t) ? t.byteLength : t.size, this.#e.push(t);
		}
		this.#r = `${n.endings === void 0 ? "transparent" : n.endings}`;
		let i = n.type === void 0 ? "" : String(n.type);
		this.#t = /^[\x20-\x7E]*$/.test(i) ? i : "";
	}
	get size() {
		return this.#n;
	}
	get type() {
		return this.#t;
	}
	async text() {
		let e = new TextDecoder(), t = "";
		for await (let n of _(this.#e, !1)) t += e.decode(n, { stream: !0 });
		return t += e.decode(), t;
	}
	async arrayBuffer() {
		let e = new Uint8Array(this.size), t = 0;
		for await (let n of _(this.#e, !1)) e.set(n, t), t += n.length;
		return e.buffer;
	}
	stream() {
		let e = _(this.#e, !0);
		return new globalThis.ReadableStream({
			type: "bytes",
			async pull(t) {
				let n = await e.next();
				n.done ? t.close() : t.enqueue(n.value);
			},
			async cancel() {
				await e.return();
			}
		});
	}
	slice(t = 0, n = this.size, r = "") {
		let { size: i } = this, a = t < 0 ? Math.max(i + t, 0) : Math.min(t, i), o = n < 0 ? Math.max(i + n, 0) : Math.min(n, i), s = Math.max(o - a, 0), c = this.#e, l = [], u = 0;
		for (let e of c) {
			if (u >= s) break;
			let t = ArrayBuffer.isView(e) ? e.byteLength : e.size;
			if (a && t <= a) a -= t, o -= t;
			else {
				let n;
				ArrayBuffer.isView(e) ? (n = e.subarray(a, Math.min(t, o)), u += n.byteLength) : (n = e.slice(a, Math.min(t, o)), u += n.size), o -= t, l.push(n), a = 0;
			}
		}
		let d = new e([], { type: String(r).toLowerCase() });
		return d.#n = s, d.#e = l, d;
	}
	get [Symbol.toStringTag]() {
		return "Blob";
	}
	static [Symbol.hasInstance](e) {
		return e && typeof e == "object" && typeof e.constructor == "function" && (typeof e.stream == "function" || typeof e.arrayBuffer == "function") && /^(Blob|File)$/.test(e[Symbol.toStringTag]);
	}
};
Object.defineProperties(v.prototype, {
	size: { enumerable: !0 },
	type: { enumerable: !0 },
	slice: { enumerable: !0 }
});
var y = v, b = class extends y {
	#e = 0;
	#t = "";
	constructor(e, t, n = {}) {
		if (arguments.length < 2) throw TypeError(`Failed to construct 'File': 2 arguments required, but only ${arguments.length} present.`);
		super(e, n), n === null && (n = {});
		let r = n.lastModified === void 0 ? Date.now() : Number(n.lastModified);
		Number.isNaN(r) || (this.#e = r), this.#t = String(t);
	}
	get name() {
		return this.#t;
	}
	get lastModified() {
		return this.#e;
	}
	get [Symbol.toStringTag]() {
		return "File";
	}
	static [Symbol.hasInstance](e) {
		return !!e && e instanceof y && /^(File)$/.test(e[Symbol.toStringTag]);
	}
}, { toStringTag: x, iterator: ee, hasInstance: S } = Symbol, C = Math.random, te = "append,set,get,getAll,delete,keys,values,entries,forEach,constructor".split(","), w = (e, t, n) => (e += "", /^(Blob|File)$/.test(t && t[x]) ? [(n = n === void 0 ? t[x] == "File" ? t.name : "blob" : n + "", e), t.name !== n || t[x] == "blob" ? new b([t], n, t) : t] : [e, t + ""]), T = (e, t) => (t ? e : e.replace(/\r?\n|\r/g, "\r\n")).replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22"), E = (e, t, n) => {
	if (t.length < n) throw TypeError(`Failed to execute '${e}' on 'FormData': ${n} arguments required, but only ${t.length} present.`);
}, D = class {
	#e = [];
	constructor(...e) {
		if (e.length) throw TypeError("Failed to construct 'FormData': parameter 1 is not of type 'HTMLFormElement'.");
	}
	get [x]() {
		return "FormData";
	}
	[ee]() {
		return this.entries();
	}
	static [S](e) {
		return e && typeof e == "object" && e[x] === "FormData" && !te.some((t) => typeof e[t] != "function");
	}
	append(...e) {
		E("append", arguments, 2), this.#e.push(w(...e));
	}
	delete(e) {
		E("delete", arguments, 1), e += "", this.#e = this.#e.filter(([t]) => t !== e);
	}
	get(e) {
		E("get", arguments, 1), e += "";
		for (var t = this.#e, n = t.length, r = 0; r < n; r++) if (t[r][0] === e) return t[r][1];
		return null;
	}
	getAll(e, t) {
		return E("getAll", arguments, 1), t = [], e += "", this.#e.forEach((n) => n[0] === e && t.push(n[1])), t;
	}
	has(e) {
		return E("has", arguments, 1), e += "", this.#e.some((t) => t[0] === e);
	}
	forEach(e, t) {
		E("forEach", arguments, 1);
		for (var [n, r] of this) e.call(t, r, n, this);
	}
	set(...e) {
		E("set", arguments, 2);
		var t = [], n = !0;
		e = w(...e), this.#e.forEach((r) => {
			r[0] === e[0] ? n &&= !t.push(e) : t.push(r);
		}), n && t.push(e), this.#e = t;
	}
	*entries() {
		yield* this.#e;
	}
	*keys() {
		for (var [e] of this) yield e;
	}
	*values() {
		for (var [, e] of this) yield e;
	}
};
function ne(e, t = y) {
	var n = `${C()}${C()}`.replace(/\./g, "").slice(-28).padStart(32, "-"), r = [], i = `--${n}\r\nContent-Disposition: form-data; name="`;
	return e.forEach((e, t) => typeof e == "string" ? r.push(i + T(t) + `"\r\n\r\n${e.replace(/\r(?!\n)|(?<!\r)\n/g, "\r\n")}\r\n`) : r.push(i + T(t) + `"; filename="${T(e.name, 1)}"\r\nContent-Type: ${e.type || "application/octet-stream"}\r\n\r\n`, e, "\r\n")), r.push(`--${n}--`), new t(r, { type: "multipart/form-data; boundary=" + n });
}
(/* @__PURE__ */ l(((e, t) => {
	if (!globalThis.DOMException) try {
		let { MessageChannel: e } = m("worker_threads"), t = new e().port1, n = /* @__PURE__ */ new ArrayBuffer();
		t.postMessage(n, [n, n]);
	} catch (e) {
		e.constructor.name === "DOMException" && (globalThis.DOMException = e.constructor);
	}
	t.exports = globalThis.DOMException;
})))();
var { stat: re } = t;
//#endregion
export { l as a, m as c, y as i, p as l, ne as n, c as o, b as r, u as s, D as t, f as u };
