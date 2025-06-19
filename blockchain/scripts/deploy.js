const hre = require("hardhat");

async function main() {
  console.log("Deploying to Sepolia...");

  const ProductRegistry = await hre.ethers.getContractFactory("ProductRegistry");
  const registry = await ProductRegistry.deploy();

  await registry.deployed();
  console.log("✅ Contract deployed to:", registry.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
