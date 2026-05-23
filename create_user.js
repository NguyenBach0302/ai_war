const bcrypt = require('bcrypt');
const pool = require('./server/db');

async function createTestAccount() {
    const username = 'admin';
    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    try {
        await pool.query('INSERT INTO users (username, password, gold, role) VALUES (?, ?, ?, ?)', [username, hashedPassword, 1000, 0]);
        console.log(`Test account created:`);
        console.log(`Username: ${username}`);
        console.log(`Password: ${password}`);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            console.log('Account already exists.');
        } else {
            console.error('Error creating account:', err);
        }
    } finally {
        process.exit();
    }
}

createTestAccount();
