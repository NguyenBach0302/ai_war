package com.example.game.common.protocol;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;

/**
 * Translates {@link Message} objects to/from their newline-delimited JSON wire
 * form.
 *
 * <p>We use one JSON object per line ("NDJSON"): the writer appends {@code \n}
 * after each frame and the reader splits on lines. Jackson never emits raw
 * newlines inside a value (they are escaped), so line framing is unambiguous
 * and far simpler than length-prefixing. The {@link ObjectMapper} is thread
 * safe once configured, so a single shared instance is fine.
 */
public final class Codec {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            // Be lenient about unknown fields so old clients can talk to new servers.
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

    private Codec() {
    }

    /** Serialize a message to a single-line JSON string (no trailing newline). */
    public static String encode(Message message) throws IOException {
        return MAPPER.writeValueAsString(message);
    }

    /** Parse one line of JSON into a message. */
    public static Message decode(String line) throws IOException {
        return MAPPER.readValue(line, Message.class);
    }
}
