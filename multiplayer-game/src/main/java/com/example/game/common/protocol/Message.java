package com.example.game.common.protocol;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.HashMap;
import java.util.Map;

/**
 * A single protocol frame. Serialized to one line of JSON on the wire by
 * {@link Codec}.
 *
 * <p>The {@link #type} fixes the meaning; {@link #data} is an open key/value bag
 * so the protocol can evolve without a class explosion. Typed accessors
 * ({@link #getString}, {@link #getInt}) provide null-safe coercion at call
 * sites so handlers stay readable.
 *
 * <p>Instances are effectively immutable once built; use the {@link #of}
 * factory and chained {@link #with} calls to construct them.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public final class Message {

    private final MessageType type;
    private final Map<String, Object> data;

    @JsonCreator
    public Message(@JsonProperty("type") MessageType type,
                   @JsonProperty("data") Map<String, Object> data) {
        this.type = type;
        this.data = data != null ? data : new HashMap<>();
    }

    /** Start a new message of the given type with an empty payload. */
    public static Message of(MessageType type) {
        return new Message(type, new HashMap<>());
    }

    /** Returns a copy of this message with one additional payload entry. */
    public Message with(String key, Object value) {
        Map<String, Object> copy = new HashMap<>(this.data);
        copy.put(key, value);
        return new Message(this.type, copy);
    }

    public MessageType getType() {
        return type;
    }

    public Map<String, Object> getData() {
        return data;
    }

    // ----- Null-safe typed accessors -----

    public String getString(String key) {
        Object v = data.get(key);
        return v == null ? null : v.toString();
    }

    /** @return the int value, or {@code defaultValue} if absent/unparsable. */
    public int getInt(String key, int defaultValue) {
        Object v = data.get(key);
        if (v instanceof Number n) {
            return n.intValue();
        }
        if (v != null) {
            try {
                return Integer.parseInt(v.toString());
            } catch (NumberFormatException ignored) {
                // fall through to default
            }
        }
        return defaultValue;
    }

    @Override
    public String toString() {
        return "Message{type=" + type + ", data=" + data + '}';
    }
}
