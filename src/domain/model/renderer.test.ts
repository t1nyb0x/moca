import { describe, expect, it } from "vitest";
import { isSoftwareRenderer } from "./renderer";

describe("isSoftwareRenderer", () => {
  it.each([
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
    "Google SwiftShader",
    "llvmpipe (LLVM 15.0.7, 256 bits)",
    "Microsoft Basic Render Driver",
    "Mesa/X.org, softpipe",
    "lavapipe (LLVM 17.0.6, 256 bits)",
  ])("ソフトウェア実装を見つける: %s", (name) => {
    expect(isSoftwareRenderer(name)).toBe(true);
  });

  it.each([
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Apple GPU",
  ])("実際の GPU を誤検出しない: %s", (name) => {
    expect(isSoftwareRenderer(name)).toBe(false);
  });

  it("大文字小文字を問わない", () => {
    expect(isSoftwareRenderer("GOOGLE SWIFTSHADER")).toBe(true);
  });

  it("名前が取れなくても落ちない", () => {
    expect(isSoftwareRenderer("")).toBe(false);
  });
});
