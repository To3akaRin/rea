/** Inert thin Mach-O commands with explicit widths, byte order and command sizes. */
export const machoLoadCommands = (
  bits: 32 | 64,
  sizes: readonly number[],
  byteOrder: "little" | "big" = "little",
): Buffer => {
  const headerSize = bits === 64 ? 32 : 28;
  const commandBytes = sizes.reduce((total, size) => total + size, 0);
  const bytes = Buffer.alloc(headerSize + commandBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const write = (offset: number, value: number) =>
    view.setUint32(offset, value, byteOrder === "little");
  [
    bits === 64 ? 0xfeedfacf : 0xfeedface,
    bits === 64 ? 0x0100000c : 7,
    bits === 64 ? 0 : 3,
    2,
    sizes.length,
    commandBytes,
  ].forEach((value, index) => write(index * 4, value));
  let offset = headerSize;
  for (const size of sizes) {
    write(offset, 0x7f000001); // Unknown, non-required command.
    write(offset + 4, size);
    offset += size;
  }
  return bytes;
};
