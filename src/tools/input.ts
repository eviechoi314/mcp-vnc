// src/tools/input.ts
import { VncClient } from '@computernewb/nodejs-rfb';
import { VncConnectionManager } from '../vnc/client.js';
import { parseKeyInput, getKeysym, charNeedsShift } from '../vnc/keyboard.js';

export async function handleClick(
  vncManager: VncConnectionManager, 
  args: { x: number; y: number; button?: string; double?: boolean }
) {
  return vncManager.executeWithConnection(async (client) => {
    // Validate coordinates
    const coordValidation = vncManager.validateCoordinates(client, args.x, args.y);
    if (!coordValidation.valid) {
      throw new Error(coordValidation.error!);
    }

    const buttonMap = {
      'left': 0x01,
      'right': 0x04,
      'middle': 0x02
    };

    const button = args.button || 'left';
    const isDouble = args.double || false;
    const buttonMask = buttonMap[button as keyof typeof buttonMap] || buttonMap.left;

    if (isDouble) {
      // Perform double-click: two quick clicks with short delay
      client.sendPointerEvent(args.x, args.y, buttonMask);
      await new Promise(resolve => setTimeout(resolve, 50));
      client.sendPointerEvent(args.x, args.y, 0);
      await new Promise(resolve => setTimeout(resolve, 50));
      client.sendPointerEvent(args.x, args.y, buttonMask);
      await new Promise(resolve => setTimeout(resolve, 50));
      client.sendPointerEvent(args.x, args.y, 0);
    } else {
      // Single click
      client.sendPointerEvent(args.x, args.y, buttonMask);
      await new Promise(resolve => setTimeout(resolve, 100));
      client.sendPointerEvent(args.x, args.y, 0);
    }

    const clickType = isDouble ? 'double-clicked' : 'clicked';
    return {
      content: [{ type: 'text', text: `${clickType} ${button} button at (${args.x}, ${args.y})` }]
    };
  });
}

export async function handleMoveMouse(
  vncManager: VncConnectionManager, 
  args: { x: number; y: number }
) {
  return vncManager.executeWithConnection(async (client) => {
    // Validate coordinates
    const coordValidation = vncManager.validateCoordinates(client, args.x, args.y);
    if (!coordValidation.valid) {
      throw new Error(coordValidation.error!);
    }

    client.sendPointerEvent(args.x, args.y, 0);

    return {
      content: [{ type: 'text', text: `Moved mouse to (${args.x}, ${args.y})` }]
    };
  });
}

export async function handleKeyPress(
  vncManager: VncConnectionManager, 
  args: { key: string }
) {
  return vncManager.executeWithConnection(async (client) => {
    const { modifiers, key } = parseKeyInput(args.key);
    
    if (modifiers.length === 0) {
      // Single key press
      const keysym = getKeysym(key);
      client.sendKeyEvent(keysym, true);
      await new Promise(resolve => setTimeout(resolve, 50));
      client.sendKeyEvent(keysym, false);
    } else {
      // Key combination - press modifiers first, then main key, then release in reverse order
      const modifierKeysyms = modifiers.map(mod => getKeysym(mod));
      const mainKeysym = getKeysym(key);
      
      // Press all modifier keys
      for (const modKeysym of modifierKeysyms) {
        client.sendKeyEvent(modKeysym, true);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      // Press main key
      client.sendKeyEvent(mainKeysym, true);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Release main key
      client.sendKeyEvent(mainKeysym, false);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Release modifier keys in reverse order
      for (let i = modifierKeysyms.length - 1; i >= 0; i--) {
        client.sendKeyEvent(modifierKeysyms[i], false);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    return {
      content: [{ type: 'text', text: `Pressed key combination: ${args.key}` }]
    };
  });
}

export async function handleTypeText(
  vncManager: VncConnectionManager, 
  args: { text: string; enter?: boolean }
) {
  return vncManager.executeWithConnection(async (client) => {
    // Single-line text input only
    await typeString(client, args.text);

    // Press Enter only if explicitly requested
    if (args.enter) {
      const enterKeysym = getKeysym('Return');
      client.sendKeyEvent(enterKeysym, true);
      await new Promise(resolve => setTimeout(resolve, 50));
      client.sendKeyEvent(enterKeysym, false);
    }

    const enterText = args.enter ? ' + Enter' : '';
    return {
      content: [{ type: 'text', text: `Typed text: ${args.text}${enterText}` }]
    };
  });
}

export async function handleTypeMultiline(
  vncManager: VncConnectionManager, 
  args: { lines: string[] }
) {
  return vncManager.executeWithConnection(async (client) => {
    // Multi-line mode: type each string as a separate line with Enter after each
    for (const line of args.lines) {
      await typeString(client, line);
      
      // Always press Enter after each line
      const enterKeysym = getKeysym('Return');
      client.sendKeyEvent(enterKeysym, true);
      await new Promise(resolve => setTimeout(resolve, 50));
      client.sendKeyEvent(enterKeysym, false);
      await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause between lines
    }

    return {
      content: [{ type: 'text', text: `Typed ${args.lines.length} lines: ${args.lines.join(' | ')}` }]
    };
  });
}

async function typeString(client: any, text: string) {
  // Determine if this text needs slower typing
  const hasSpecialChars = /[|:;&<>?/\\~`!@#$%^*()+=\[\]{}'",-]/.test(text);
  const isLongText = text.length > 10;
  const useSlowTyping = hasSpecialChars || isLongText;

  // Use different timing based on text complexity
  const keyHoldTime = useSlowTyping ? 75 : 50;
  const betweenKeyDelay = useSlowTyping ? 100 : 50;

  for (const char of text) {
    await typeCharacter(client, char, keyHoldTime, betweenKeyDelay);
  }
}

async function typeCharacter(
  vncClient: VncClient,
  char: string,
  keyHoldTime: number,
  betweenKeyDelay: number
) {
  // Send the character's own keysym directly (e.g. 'ampersand', not 'seven'
  // plus a manually-held Shift). RFB key events carry a resolved keysym, and
  // the server (Xvnc/tigervnc) is responsible for synthesizing whatever
  // keycode+modifier combo produces it — exactly what a real client like
  // Remmina relies on. Manually toggling a separate Shift keysym around the
  // *unshifted* keysym doesn't reliably combine on the server side, which
  // was producing bare unshifted characters ('&' -> '7', '~' -> '`', etc.)
  // for every shifted symbol. See handleKeyPress, which never had this
  // problem because it always sent the real target keysym.
  const keysym = getKeysym(char);
  const needsShift = charNeedsShift(char);

  console.error(`Typing '${char}' with keysym 0x${keysym.toString(16)}${needsShift ? ' (shifted)' : ''}`);

  try {
    vncClient.sendKeyEvent(keysym, true);
    await new Promise(resolve => setTimeout(resolve, keyHoldTime));
    vncClient.sendKeyEvent(keysym, false);

    await new Promise(resolve => setTimeout(resolve, betweenKeyDelay));
  } catch (error) {
    console.error(`VNC library error typing character '${char}':`, error);
    // Rethrow to fail the entire text operation and allow client retry
    throw new Error(`VNC buffer error typing character '${char}'. This may be a temporary issue - please retry the operation.`);
  }
}
