package com.cloudstream.desktop.bridge

/**
 * A minimal JSON object writer.
 *
 * Deliberately hand-rolled rather than using Jackson or kotlinx.serialization,
 * both of which are on this class loader. Those libraries reflect over the
 * *declared* shape of a type, and the values written here are instances of
 * classes that arrived from a plugin's own class loader — subclasses the
 * serializer has never seen, sometimes carrying fields it would choke on.
 * Reading only the properties the desktop app consumes, through the public API,
 * is smaller and immune to whatever a provider added to its subclass.
 *
 * Null fields are omitted rather than written as `null`, which keeps the wire
 * format aligned with the optional properties on the TypeScript side.
 */
internal class JsonWriter {
    private val sb = StringBuilder()
    private var needsComma = false

    private fun key(name: String) {
        if (needsComma) sb.append(',')
        needsComma = true
        writeString(name)
        sb.append(':')
    }

    fun field(name: String, value: String?) {
        if (value == null) return
        key(name)
        writeString(value)
    }

    fun field(name: String, value: Int?) {
        if (value == null) return
        key(name)
        sb.append(value)
    }

    fun field(name: String, value: Long?) {
        if (value == null) return
        key(name)
        sb.append(value)
    }

    fun field(name: String, value: Double?) {
        if (value == null || value.isNaN() || value.isInfinite()) return
        key(name)
        sb.append(value)
    }

    fun field(name: String, value: Boolean?) {
        if (value == null) return
        key(name)
        sb.append(value)
    }

    fun stringArray(name: String, values: Collection<String>?) {
        if (values == null) return
        key(name)
        sb.append('[')
        values.forEachIndexed { index, value ->
            if (index > 0) sb.append(',')
            writeString(value)
        }
        sb.append(']')
    }

    fun stringMap(name: String, values: Map<String, String>?) {
        if (values.isNullOrEmpty()) return
        key(name)
        sb.append('{')
        var first = true
        for ((k, v) in values) {
            if (!first) sb.append(',')
            first = false
            writeString(k)
            sb.append(':')
            writeString(v)
        }
        sb.append('}')
    }

    /** Writes an array whose elements are already-serialised JSON documents. */
    fun rawArray(name: String, values: Collection<String>) {
        key(name)
        sb.append('[')
        values.forEachIndexed { index, value ->
            if (index > 0) sb.append(',')
            sb.append(value)
        }
        sb.append(']')
    }

    /** Writes an already-serialised JSON document as a single field value. */
    fun raw(name: String, value: String?) {
        if (value == null) return
        key(name)
        sb.append(value)
    }

    fun finish(): String = "{$sb}"

    private fun writeString(value: String) {
        sb.append('"')
        for (ch in value) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                else ->
                    // Control characters and lone surrogates would produce a
                    // document the host's JSON.parse rejects.
                    if (ch < ' ' || ch.isSurrogate()) {
                        sb.append("\\u").append(ch.code.toString(16).padStart(4, '0'))
                    } else {
                        sb.append(ch)
                    }
            }
        }
        sb.append('"')
    }
}

/** Builds one JSON object. */
internal fun json(build: JsonWriter.() -> Unit): String =
    JsonWriter().apply(build).finish()

/** Wraps already-serialised documents into a JSON array. */
internal fun jsonArray(values: Collection<String>): String =
    values.joinToString(prefix = "[", postfix = "]", separator = ",")
