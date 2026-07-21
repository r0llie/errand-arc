# Errand — Smart Contracts

> Security warning: the original sample below is not production-ready and must
> not be copied verbatim. `08-ARC-AGENTIC-IMPLEMENTATION.md` defines the required
> escrow invariants and is authoritative.

## Overview

Two project contracts are planned for Arc Testnet: the required `OrderEscrow`
and the optional `MerchantRegistry`. Use Hardhat + viem for deployment.

---

## Setup

```bash
cd packages/contracts
pnpm add --save-dev hardhat @nomicfoundation/hardhat-toolbox-viem
pnpm add @openzeppelin/contracts
```

### hardhat.config.ts

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    arcTestnet: {
      url: process.env.ARC_TESTNET_RPC!,
      chainId: Number(process.env.ARC_TESTNET_CHAIN_ID),
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
    },
  },
};
export default config;
```

---

## OrderEscrow.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract OrderEscrow is ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant MERCHANT_ROLE = keccak256("MERCHANT_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    IERC20 public immutable usdc;

    enum OrderStatus {
        Funded,
        Preparing,
        Ready,
        Completed,
        Refunded,
        Disputed
    }

    struct Order {
        address buyer;
        address merchant;
        uint256 amount;
        bytes32 deliveryCodeHash;
        uint256 pickupDeadline;   // unix timestamp
        OrderStatus status;
    }

    mapping(bytes32 => Order) public orders;

    event OrderFunded(bytes32 indexed orderId, address buyer, address merchant, uint256 amount);
    event OrderPreparing(bytes32 indexed orderId);
    event OrderReady(bytes32 indexed orderId);
    event OrderCompleted(bytes32 indexed orderId, uint256 releasedAt);
    event OrderRefunded(bytes32 indexed orderId, string reason);
    event OrderDisputed(bytes32 indexed orderId);

    error OrderNotFound();
    error WrongStatus(OrderStatus current, OrderStatus expected);
    error InvalidDeliveryCode();
    error DeadlineNotPassed();
    error DeadlinePassed();
    error OnlyBuyer();
    error OnlyMerchant();
    error AlreadyFunded();

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ARBITER_ROLE, msg.sender);
    }

    function fund(
        bytes32 orderId,
        address merchant,
        uint256 amount,
        bytes32 deliveryCodeHash,
        uint256 pickupDeadline
    ) external nonReentrant {
        if (orders[orderId].buyer != address(0)) revert AlreadyFunded();
        require(merchant != address(0), "Zero merchant");
        require(amount > 0, "Zero amount");
        require(pickupDeadline > block.timestamp, "Invalid deadline");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        orders[orderId] = Order({
            buyer: msg.sender,
            merchant: merchant,
            amount: amount,
            deliveryCodeHash: deliveryCodeHash,
            pickupDeadline: pickupDeadline,
            status: OrderStatus.Funded
        });

        emit OrderFunded(orderId, msg.sender, merchant, amount);
    }

    function markPreparing(bytes32 orderId) external {
        Order storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderNotFound();
        if (msg.sender != order.merchant) revert OnlyMerchant();
        if (order.status != OrderStatus.Funded)
            revert WrongStatus(order.status, OrderStatus.Funded);

        order.status = OrderStatus.Preparing;
        emit OrderPreparing(orderId);
    }

    function markReady(bytes32 orderId) external {
        Order storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderNotFound();
        if (msg.sender != order.merchant) revert OnlyMerchant();
        if (order.status != OrderStatus.Preparing)
            revert WrongStatus(order.status, OrderStatus.Preparing);

        order.status = OrderStatus.Ready;
        emit OrderReady(orderId);
    }

    function confirmPickup(
        bytes32 orderId,
        string calldata deliveryCode,
        bytes32 salt
    )
        external nonReentrant
    {
        Order storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderNotFound();
        if (order.status != OrderStatus.Ready)
            revert WrongStatus(order.status, OrderStatus.Ready);
        if (msg.sender != order.merchant) revert OnlyMerchant();
        if (block.timestamp > order.pickupDeadline) revert DeadlinePassed();
        if (keccak256(abi.encode(orderId, deliveryCode, salt)) != order.deliveryCodeHash)
            revert InvalidDeliveryCode();

        order.status = OrderStatus.Completed;
        usdc.safeTransfer(order.merchant, order.amount);

        emit OrderCompleted(orderId, block.timestamp);
    }

    function refund(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderNotFound();

        bool isBuyer = msg.sender == order.buyer;
        bool deadlinePassed = block.timestamp > order.pickupDeadline;
        bool canRefund =
            (isBuyer && order.status == OrderStatus.Funded) || deadlinePassed;

        require(canRefund, "Not authorized to refund");
        require(
            order.status == OrderStatus.Funded ||
            order.status == OrderStatus.Preparing ||
            order.status == OrderStatus.Ready,
            "Cannot refund in current status"
        );

        order.status = OrderStatus.Refunded;
        usdc.safeTransfer(order.buyer, order.amount);

        emit OrderRefunded(orderId, deadlinePassed ? "deadline_passed" : "user_cancelled");
    }

    function dispute(bytes32 orderId) external {
        Order storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderNotFound();
        require(
            msg.sender == order.buyer || msg.sender == order.merchant,
            "Only buyer or merchant"
        );
        require(
            order.status == OrderStatus.Funded ||
            order.status == OrderStatus.Preparing ||
            order.status == OrderStatus.Ready,
            "Order is not active"
        );
        order.status = OrderStatus.Disputed;
        emit OrderDisputed(orderId);
    }

    function resolve(bytes32 orderId, bool releaseToMerchant)
        external onlyRole(ARBITER_ROLE) nonReentrant
    {
        Order storage order = orders[orderId];
        if (order.buyer == address(0)) revert OrderNotFound();
        require(order.status == OrderStatus.Disputed, "Not disputed");

        order.status = releaseToMerchant ? OrderStatus.Completed : OrderStatus.Refunded;
        address recipient = releaseToMerchant ? order.merchant : order.buyer;
        usdc.safeTransfer(recipient, order.amount);

        if (releaseToMerchant) {
            emit OrderCompleted(orderId, block.timestamp);
        } else {
            emit OrderRefunded(orderId, "arbiter_decision");
        }
    }

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
}
```

---

## MerchantRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract MerchantRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Merchant {
        string name;
        string category;
        int256 lat;       // multiply by 1e6 for 6 decimal precision
        int256 lng;
        address wallet;
        bool isActive;
    }

    mapping(address => Merchant) public merchants;
    address[] public merchantList;

    event MerchantRegistered(address indexed wallet, string name, string category);
    event MerchantUpdated(address indexed wallet);
    event MerchantDeactivated(address indexed wallet);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);
    }

    function register(
        address wallet,
        string calldata name,
        string calldata category,
        int256 lat,
        int256 lng
    ) external onlyRole(REGISTRAR_ROLE) {
        merchants[wallet] = Merchant({
            name: name,
            category: category,
            lat: lat,
            lng: lng,
            wallet: wallet,
            isActive: true
        });
        merchantList.push(wallet);
        emit MerchantRegistered(wallet, name, category);
    }

    function getMerchants() external view returns (address[] memory) {
        return merchantList;
    }

    function isRegistered(address wallet) external view returns (bool) {
        return merchants[wallet].isActive;
    }
}
```

---

## Deploy Script

```typescript
// packages/contracts/scripts/deploy.ts
import { viem } from "hardhat";

async function main() {
  const [deployer] = await viem.getWalletClients();
  console.log("Deploying with:", deployer.account.address);

  // 1. Deploy OrderEscrow
  const escrow = await viem.deployContract("OrderEscrow", [
    process.env.USDC_CONTRACT_ADDRESS as `0x${string}`,
  ]);
  console.log("OrderEscrow:", escrow.address);

  // 2. Deploy MerchantRegistry
  const registry = await viem.deployContract("MerchantRegistry", []);
  console.log("MerchantRegistry:", registry.address);

  // Save addresses
  console.log("\n--- Add to .env ---");
  console.log(`ESCROW_CONTRACT_ADDRESS=${escrow.address}`);
  console.log(`MERCHANT_REGISTRY_ADDRESS=${registry.address}`);
}

main().catch(console.error);
```

```bash
pnpm hardhat run scripts/deploy.ts --network arcTestnet
```
