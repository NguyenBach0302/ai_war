package com.example.game.server.service;

/** Raised when login credentials are rejected. */
public class AuthenticationException extends RuntimeException {
    public AuthenticationException(String message) {
        super(message);
    }
}
