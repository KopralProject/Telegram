const axios = require('axios');

const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';

class Cloudflare {
    constructor(email, apiKey) {
        this.headers = {
            'X-Auth-Email': email,
            'X-Auth-Key': apiKey,
            'Content-Type': 'application/json'
        };
    }

    async getZones() {
        try {
            const response = await axios.get(`${CLOUDFLARE_API_BASE_URL}/zones`, { headers: this.headers });
            return response.data.result;
        } catch (error) {
            console.error('Error fetching zones:', error.response ? error.response.data : error.message);
            throw new Error('Failed to fetch Cloudflare zones.');
        }
    }

    async getDNSRecords(zoneId, type = 'A', name = '*') {
        try {
            const params = { type: type };
            if (name) {
                params.name = name;
            }
            const response = await axios.get(`${CLOUDFLARE_API_BASE_URL}/zones/${zoneId}/dns_records`, {
                headers: this.headers,
                params: params
            });
            return response.data.result;
        } catch (error) {
            console.error(`Error fetching DNS records for zone ${zoneId}:`, error.response ? error.response.data : error.message);
            throw new Error(`Failed to fetch DNS records for zone ID ${zoneId}.`);
        }
    }

    async createDNSRecord(zoneId, type, name, content, proxied = false, ttl = 1) {
        try {
            const data = {
                type,
                name,
                content,
                proxied,
                ttl
            };
            const response = await axios.post(`${CLOUDFLARE_API_BASE_URL}/zones/${zoneId}/dns_records`, data, { headers: this.headers });
            return response.data.result;
        } catch (error) {
            console.error('Error creating DNS record:', error.response ? error.response.data : error.message);
            throw new Error('Failed to create DNS record.');
        }
    }

    async deleteDNSRecord(zoneId, recordId) {
        try {
            const response = await axios.delete(`${CLOUDFLARE_API_BASE_URL}/zones/${zoneId}/dns_records/${recordId}`, { headers: this.headers });
            return response.data.result;
        } catch (error) {
            console.error(`Error deleting DNS record ${recordId}:`, error.response ? error.response.data : error.message);
            throw new Error(`Failed to delete DNS record ${recordId}.`);
        }
    }

    async updateDNSRecord(zoneId, recordId, type, name, content, proxied = false, ttl = 1) {
        try {
            const data = {
                type,
                name,
                content,
                proxied,
                ttl
            };
            const response = await axios.put(`${CLOUDFLARE_API_BASE_URL}/zones/${zoneId}/dns_records/${recordId}`, data, { headers: this.headers });
            return response.data.result;
        } catch (error) {
            console.error(`Error updating DNS record ${recordId}:`, error.response ? error.response.data : error.message);
            throw new Error(`Failed to update DNS record ${recordId}.`);
        }
    }
}

module.exports = Cloudflare;
