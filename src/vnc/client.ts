// src/vnc/client.ts
import { VncClient } from '@computernewb/nodejs-rfb';
import { VncConfig, CoordinateValidation } from '../types.js';

export class VncConnectionManager {
  private config: VncConfig;

  constructor(config: VncConfig) {
    this.config = config;
  }

  // Execute a callback with a fresh VNC connection that waits for full framebuffer
  async executeWithConnection<T>(callback: (client: VncClient) => Promise<T>): Promise<T> {
    const client = await this.createConnection();
    try {
      const result = await callback(client);
      return result;
    } finally {
      this.disconnect(client);
    }
  }

  private async createConnection(): Promise<VncClient> {
    return new Promise((resolve, reject) => {
      const vncClient = new VncClient({
        debug: false,
        // Raw + copyRect only, no hextile/zrle. TigerVNC's EncodeManager will
        // still choose whichever offered encoding it estimates is "best" per
        // rectangle regardless of our preference order, and for photographic/
        // video content it happily picks Hextile's CPU-heavy per-rect analysis
        // (Indexed RLE / Full Colour sub-encoding) over cheap Raw - that CPU
        // cost, not network transfer, was what pushed full-frame requests past
        // the connection timeout. With Hextile not offered at all the server
        // has nothing to fall back to but Raw, which is just a memcpy of the
        // framebuffer - a full 1440x900x4B frame is ~5MB, trivial over LAN.
        encodings: [
          VncClient.consts.encodings.raw,
          VncClient.consts.encodings.copyRect
          // Removed zrle as it seems to cause "Invalid subencoding" errors on some servers
        ]
      });

      let hasReceivedInitialFramebuffer = false;
      // Once settled (resolved or rejected), any further error/timeout must not
      // reject again - but on the failure paths it must still disconnect this
      // vncClient. Previously, timeout/error only rejected the Promise, leaving
      // this object (and its live TCP socket) orphaned with nothing left holding
      // a reference to close it - the socket just stayed ESTABLISHED on the
      // server until it eventually piled up enough to make every subsequent
      // connection attempt start timing out too.
      let settled = false;

      const failAndCleanup = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        try {
          vncClient.disconnect();
        } catch (disconnectError) {
          console.error('Error disconnecting failed VNC client:', disconnectError);
        }
        reject(err);
      };

      vncClient.on('connected', () => {
        console.error(`Connected to VNC server at ${this.config.host}:${this.config.port}`);
      });

      vncClient.on('authenticated', () => {
        const screenWidth = vncClient.clientWidth || 0;
        const screenHeight = vncClient.clientHeight || 0;
        console.error(`VNC authenticated, screen: ${screenWidth}x${screenHeight}`);

        // Request the initial full framebuffer
        vncClient.requestFrameUpdate(false, 0, 0, screenWidth, screenHeight);
      });

      vncClient.on('frameUpdated', () => {
        if (!hasReceivedInitialFramebuffer && !settled) {
          hasReceivedInitialFramebuffer = true;
          settled = true;
          clearTimeout(timeoutHandle);
          console.error('Received initial framebuffer, connection ready');
          resolve(vncClient);
        }
      });

      vncClient.on('error', (error) => {
        console.error(`VNC connection error: ${error.message}`);
        failAndCleanup(new Error(`VNC connection error: ${error.message}`));
      });

      // Handle VNC disconnections
      vncClient.on('disconnect', (reason) => {
        console.error(`VNC disconnected: ${reason}`);
      });

      const connectionOptions = {
        host: this.config.host,
        port: this.config.port,
        path: null,
        auth: this.config.password ? { password: this.config.password } : undefined
      };

      vncClient.connect(connectionOptions);

      const timeoutHandle = setTimeout(() => {
        failAndCleanup(new Error('VNC connection timeout'));
      }, 15000); // Increased timeout to wait for initial frame
    });
  }

  private disconnect(client: VncClient): void {
    try {
      client.disconnect();
    } catch (error) {
      console.error('Error disconnecting VNC client:', error);
    }
  }

  public validateCoordinates(client: VncClient, x: number, y: number): CoordinateValidation {
    const screenWidth = client.clientWidth || 0;
    const screenHeight = client.clientHeight || 0;
    
    if (screenWidth === 0 || screenHeight === 0) {
      return { valid: true }; // Allow if dimensions not yet known
    }
    
    if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) {
      return {
        valid: false,
        error: `Coordinates (${x}, ${y}) are outside screen bounds (0, 0) to (${screenWidth - 1}, ${screenHeight - 1})`
      };
    }
    
    return { valid: true };
  }
}
