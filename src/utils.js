const { URL } = require('url');

class Utils {
    static isValidIPv4(ip) {
        return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip);
    }

    static isValidDomain(domain) {
        // Basic domain validation for wildcard subdomains
        return /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,6}$/.test(domain);
    }

    static getParentDomain(subdomain) {
        // Removes the first part of a subdomain to get the parent domain
        const parts = subdomain.split('.');
        if (parts.length > 2) {
            return parts.slice(1).join('.');
        }
        return subdomain; // Already a top-level domain or too short
    }

    static extractWildcardSubdomain(fullDomain) {
        // Extracts the wildcard subdomain part (e.g., from *.test.example.com to *.test)
        const parts = fullDomain.split('.');
        if (parts.length > 2 && parts[0] === '*') {
            return `*.${parts[1]}`;
        }
        return fullDomain;
    }
}

module.exports = Utils;
