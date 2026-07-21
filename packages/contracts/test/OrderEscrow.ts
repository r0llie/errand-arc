import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, parseUnits, stringToBytes } from "viem";

const ONE_USDC = parseUnits("1", 6);

async function deployFixture() {
  const { viem } = await network.create();
  const [owner, buyer, merchant, outsider] = await viem.getWalletClients();
  if (!owner || !buyer || !merchant || !outsider) {
    throw new Error("Hardhat test wallets are unavailable");
  }
  const publicClient = await viem.getPublicClient();
  const testClient = await viem.getTestClient();
  const usdc = await viem.deployContract("MockUSDC");
  const escrow = await viem.deployContract("OrderEscrow", [
    usdc.address,
    owner.account.address,
  ]);
  await usdc.write.mint([buyer.account.address, 10n * ONE_USDC]);
  await usdc.write.approve([escrow.address, 10n * ONE_USDC], {
    account: buyer.account,
  });
  const latestBlock = await publicClient.getBlock();

  return {
    buyer,
    escrow,
    merchant,
    outsider,
    owner,
    publicClient,
    testClient,
    usdc,
    now: latestBlock.timestamp,
  };
}

function bytes32(label: string) {
  return keccak256(stringToBytes(label));
}

describe("OrderEscrow", () => {
  it("releases USDC only after the merchant submits the valid pickup code", async () => {
    const { buyer, escrow, merchant, usdc, now } = await deployFixture();
    const orderId = bytes32("happy-path");
    const salt = bytes32("random-salt");
    const deadline = now + 3_600n;
    const codeHash = await escrow.read.computeDeliveryCodeHash([
      orderId,
      "483921",
      salt,
    ]);

    await escrow.write.fund(
      [orderId, merchant.account.address, ONE_USDC, codeHash, deadline],
      { account: buyer.account },
    );
    assert.equal(await escrow.read.totalLiability(), ONE_USDC);
    await escrow.write.markPreparing([orderId], { account: merchant.account });
    await escrow.write.markReady([orderId], { account: merchant.account });
    await escrow.write.confirmPickup([orderId, "483921", salt], {
      account: merchant.account,
    });

    const order = await escrow.read.orders([orderId]);
    assert.equal(order[4], 4);
    assert.equal(
      await usdc.read.balanceOf([merchant.account.address]),
      ONE_USDC,
    );
    assert.equal(await escrow.read.totalLiability(), 0n);
  });

  it("rejects invalid codes, non-merchants, and terminal replays", async () => {
    const { buyer, escrow, merchant, outsider, now } = await deployFixture();
    const orderId = bytes32("invalid-code");
    const salt = bytes32("secret-salt");
    const codeHash = await escrow.read.computeDeliveryCodeHash([
      orderId,
      "111222",
      salt,
    ]);
    await escrow.write.fund(
      [orderId, merchant.account.address, ONE_USDC, codeHash, now + 3_600n],
      { account: buyer.account },
    );
    await assert.rejects(
      escrow.write.markPreparing([orderId], { account: outsider.account }),
    );
    await escrow.write.markPreparing([orderId], { account: merchant.account });
    await escrow.write.markReady([orderId], { account: merchant.account });
    await assert.rejects(
      escrow.write.confirmPickup([orderId, "wrong", salt], {
        account: merchant.account,
      }),
    );
    await escrow.write.confirmPickup([orderId, "111222", salt], {
      account: merchant.account,
    });
    await assert.rejects(
      escrow.write.confirmPickup([orderId, "111222", salt], {
        account: merchant.account,
      }),
    );
  });

  it("allows buyer cancellation only before preparation", async () => {
    const { buyer, escrow, merchant, usdc, now } = await deployFixture();
    const firstOrder = bytes32("buyer-cancel");
    const firstHash = await escrow.read.computeDeliveryCodeHash([
      firstOrder,
      "100100",
      bytes32("first-salt"),
    ]);
    await escrow.write.fund(
      [firstOrder, merchant.account.address, ONE_USDC, firstHash, now + 3_600n],
      { account: buyer.account },
    );
    await escrow.write.cancelBeforePreparation([firstOrder], {
      account: buyer.account,
    });
    assert.equal((await escrow.read.orders([firstOrder]))[4], 5);
    assert.equal(
      await usdc.read.balanceOf([buyer.account.address]),
      10n * ONE_USDC,
    );

    const secondOrder = bytes32("too-late-to-cancel");
    const secondHash = await escrow.read.computeDeliveryCodeHash([
      secondOrder,
      "200200",
      bytes32("second-salt"),
    ]);
    await escrow.write.fund(
      [
        secondOrder,
        merchant.account.address,
        ONE_USDC,
        secondHash,
        now + 3_600n,
      ],
      { account: buyer.account },
    );
    await escrow.write.markPreparing([secondOrder], {
      account: merchant.account,
    });
    await assert.rejects(
      escrow.write.cancelBeforePreparation([secondOrder], {
        account: buyer.account,
      }),
    );
  });

  it("refunds an active order after its pickup deadline", async () => {
    const { buyer, escrow, merchant, outsider, testClient, usdc, now } =
      await deployFixture();
    const orderId = bytes32("timeout-refund");
    const deadline = now + 120n;
    const codeHash = await escrow.read.computeDeliveryCodeHash([
      orderId,
      "300300",
      bytes32("timeout-salt"),
    ]);
    await escrow.write.fund(
      [orderId, merchant.account.address, ONE_USDC, codeHash, deadline],
      { account: buyer.account },
    );
    await escrow.write.markPreparing([orderId], { account: merchant.account });
    await testClient.setNextBlockTimestamp({ timestamp: deadline + 1n });
    await testClient.mine({ blocks: 1 });
    await escrow.write.refundAfterDeadline([orderId], {
      account: outsider.account,
    });

    assert.equal((await escrow.read.orders([orderId]))[4], 5);
    assert.equal(
      await usdc.read.balanceOf([buyer.account.address]),
      10n * ONE_USDC,
    );
    assert.equal(await escrow.read.totalLiability(), 0n);
  });

  it("prevents duplicate funding and only allows the owner to refund disputes", async () => {
    const { buyer, escrow, merchant, outsider, now } = await deployFixture();
    const orderId = bytes32("dispute");
    const codeHash = await escrow.read.computeDeliveryCodeHash([
      orderId,
      "400400",
      bytes32("dispute-salt"),
    ]);
    const funding = [
      orderId,
      merchant.account.address,
      ONE_USDC,
      codeHash,
      now + 3_600n,
    ] as const;
    await escrow.write.fund(funding, { account: buyer.account });
    await assert.rejects(
      escrow.write.fund(funding, { account: buyer.account }),
    );
    await escrow.write.raiseDispute([orderId], { account: merchant.account });
    await assert.rejects(
      escrow.write.refundDispute([orderId], { account: outsider.account }),
    );
    await escrow.write.refundDispute([orderId]);
    assert.equal((await escrow.read.orders([orderId]))[4], 5);
  });
});
