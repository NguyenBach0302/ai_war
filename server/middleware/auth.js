function createAuthMiddleware(jwt, jwtSecret) {
    const authenticate = (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ message: 'Unauthorized' });
        try {
            req.user = jwt.verify(token, jwtSecret);
            next();
        } catch (err) {
            res.status(401).json({ message: 'Invalid token' });
        }
    };

    const isAdmin = (req, res, next) => {
        if (req.user?.role !== 0) return res.status(403).json({ message: 'Forbidden: Admin only' });
        next();
    };

    const verifyMatchToken = token => jwt.verify(token, jwtSecret);

    return { authenticate, isAdmin, verifyMatchToken };
}

module.exports = { createAuthMiddleware };
