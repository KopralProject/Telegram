import os
import sys
import requests

# --- Mengambil Konfigurasi dari GitHub Secrets ---
# Variabel ini akan diisi oleh GitHub Actions saat runtime.
try:
    CLOUDFLARE_API_TOKEN = os.environ['CLOUDFLARE_API_TOKEN']
    CLOUDFLARE_EMAIL = os.environ['CLOUDFLARE_EMAIL']
    ZONE_NAME = os.environ['ZONE_NAME'] # Contoh: 'domainkamu.com'
    TARGET_IP = os.environ['TARGET_IP'] # IP Address tujuan yang diinput dari workflow
    TELEGRAM_BOT_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
    TELEGRAM_CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
except KeyError as e:
    print(f"Error: Secret {e} tidak ditemukan. Pastikan sudah di set di GitHub Secrets.")
    sys.exit(1)

# --- Konfigurasi API ---
CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4"
HEADERS = {
    "X-Auth-Email": CLOUDFLARE_EMAIL,
    "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
    "Content-Type": "application/json"
}
RECORD_NAME = f"*.{ZONE_NAME}"

# --- Fungsi untuk Notifikasi Telegram ---
def send_telegram_notification(message):
    """Mengirim pesan ke chat Telegram yang ditentukan."""
    api_url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        'chat_id': TELEGRAM_CHAT_ID,
        'text': message,
        'parse_mode': 'Markdown'
    }
    try:
        response = requests.post(api_url, json=payload)
        response.raise_for_status()
        print("Notifikasi Telegram berhasil dikirim.")
    except requests.exceptions.RequestException as e:
        print(f"Gagal mengirim notifikasi Telegram: {e}")

# --- Fungsi Utama ---
def main():
    """Fungsi utama untuk mengelola DNS Wildcard di Cloudflare."""
    
    # 1. Dapatkan Zone ID dari Zone Name
    print(f"Mencari Zone ID untuk '{ZONE_NAME}'...")
    try:
        response = requests.get(f"{CLOUDFLARE_API_BASE_URL}/zones?name={ZONE_NAME}", headers=HEADERS)
        response.raise_for_status()
        zones = response.json()['result']
        if not zones:
            raise ValueError(f"Zone '{ZONE_NAME}' tidak ditemukan di akun Cloudflare Anda.")
        zone_id = zones[0]['id']
        print(f"Zone ID ditemukan: {zone_id}")
    except (requests.exceptions.RequestException, ValueError, KeyError) as e:
        error_message = f"❌ Gagal mendapatkan Zone ID: {e}"
        print(error_message)
        send_telegram_notification(error_message)
        sys.exit(1)

    # 2. Cek apakah record wildcard sudah ada
    print(f"Mengecek record DNS yang ada untuk '{RECORD_NAME}'...")
    try:
        response = requests.get(f"{CLOUDFLARE_API_BASE_URL}/zones/{zone_id}/dns_records?name={RECORD_NAME}&type=A", headers=HEADERS)
        response.raise_for_status()
        existing_records = response.json()['result']
    except requests.exceptions.RequestException as e:
        error_message = f"❌ Gagal mengecek record DNS: {e}"
        print(error_message)
        send_telegram_notification(error_message)
        sys.exit(1)
        
    dns_payload = {
        "type": "A",
        "name": "*", # Cukup '*' karena Zone Name sudah terasosiasi dengan Zone ID
        "content": TARGET_IP,
        "ttl": 1,  # TTL 1 berarti 'Automatic'
        "proxied": False # Set True jika ingin mengaktifkan proxy Cloudflare (CDN)
    }

    # 3. Buat atau Perbarui Record DNS
    try:
        if existing_records:
            # Perbarui record yang ada
            record_id = existing_records[0]['id']
            print(f"Record ditemukan (ID: {record_id}). Memperbarui IP ke {TARGET_IP}...")
            api_url = f"{CLOUDFLARE_API_BASE_URL}/zones/{zone_id}/dns_records/{record_id}"
            response = requests.put(api_url, headers=HEADERS, json=dns_payload)
            action_verb = "diperbarui"
        else:
            # Buat record baru
            print(f"Record tidak ditemukan. Membuat record baru yang menunjuk ke {TARGET_IP}...")
            api_url = f"{CLOUDFLARE_API_BASE_URL}/zones/{zone_id}/dns_records"
            response = requests.post(api_url, headers=HEADERS, json=dns_payload)
            action_verb = "dibuat"
        
        response.raise_for_status() # Akan error jika API call gagal
        
        success_message = (
            f"✅ **Sukses!**\n\n"
            f"Record DNS Wildcard untuk `{ZONE_NAME}` berhasil *{action_verb}*.\n"
            f"Sekarang `*.{ZONE_NAME}` menunjuk ke IP: `{TARGET_IP}`"
        )
        print(success_message)
        send_telegram_notification(success_message)

    except requests.exceptions.RequestException as e:
        error_data = e.response.json()
        error_details = error_data.get('errors', [{}])[0].get('message', str(e))
        error_message = (
            f"❌ **Gagal!**\n\n"
            f"Terjadi kesalahan saat memproses record DNS untuk `{ZONE_NAME}`.\n"
            f"Detail: `{error_details}`"
        )
        print(error_message)
        send_telegram_notification(error_message)
        sys.exit(1)

if __name__ == "__main__":
    main()
