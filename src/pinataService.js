import { config } from './config.js';

export class PinataService {
  constructor() {
    this.jwt = config.pinataJwt;
    this.apiUrl = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
  }

  /**
   * Upload an image from a URL to IPFS via Pinata
   * @param {string} imageUrl - Direct image URL (e.g. from CoinGecko)
   * @param {string} fileName - File name to store on IPFS
   * @returns {Promise<string>} ipfs:// URI or original URL fallback
   */
  async uploadFromUrl(imageUrl, fileName = 'token_logo.png') {
    if (!this.jwt) {
      return imageUrl; // Fallback if no JWT configured
    }

    try {
      console.log(`[Pinata] Downloading image from ${imageUrl}...`);
      const imgRes = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 ClankerBot/1.0'
        }
      });

      if (!imgRes.ok) {
        console.warn(`[Pinata] Failed to download image: ${imgRes.statusText}`);
        return imageUrl;
      }

      const blob = await imgRes.blob();
      const formData = new FormData();
      formData.append('file', blob, fileName);

      console.log(`[Pinata] Uploading image to IPFS via Pinata...`);
      const uploadRes = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.jwt}`
        },
        body: formData
      });

      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        console.warn(`[Pinata] Pinata upload error: ${errorText}`);
        return imageUrl;
      }

      const data = await uploadRes.json();
      if (data.IpfsHash) {
        const ipfsUri = `ipfs://${data.IpfsHash}`;
        console.log(`[Pinata] Upload successful! IPFS URI: ${ipfsUri}`);
        return ipfsUri;
      }

      return imageUrl;
    } catch (err) {
      console.error('[Pinata] Upload exception:', err.message);
      return imageUrl;
    }
  }
}

export const pinataService = new PinataService();
