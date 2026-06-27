package com.example.game.server.service;

/** Raised when client-supplied input fails server-side validation. */
public class InvalidInputException extends RuntimeException {
    public InvalidInputException(String message) {
        super(message);
    }
}
