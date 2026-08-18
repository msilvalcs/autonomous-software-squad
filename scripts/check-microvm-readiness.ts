import { assessFirecrackerReadiness } from "../packages/runner/src/index.js";

const report = await assessFirecrackerReadiness({
  firecrackerBinary: process.env.FIRECRACKER_BINARY,
  jailerBinary: process.env.FIRECRACKER_JAILER_BINARY,
  kernelImage: process.env.FIRECRACKER_KERNEL_IMAGE,
  rootfsImage: process.env.FIRECRACKER_ROOTFS_IMAGE
});

console.log(JSON.stringify(report, null, 2));

if (!report.ready) {
  process.exitCode = 1;
}
