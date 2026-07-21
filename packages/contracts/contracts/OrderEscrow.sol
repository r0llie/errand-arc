// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract OrderEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant PICKUP_DOMAIN = keccak256("ERRAND_PICKUP_V1");

    enum Status {
        None,
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
        uint128 amount;
        uint64 pickupDeadline;
        Status status;
        bytes32 deliveryCodeHash;
    }

    IERC20 public immutable usdc;
    uint256 public totalLiability;
    mapping(bytes32 orderId => Order order) public orders;

    error AlreadyFunded();
    error DeadlineNotPassed();
    error DeadlinePassed();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidDeadline();
    error InvalidDeliveryCode();
    error InvalidStatus(Status current, Status expected);
    error NotBuyer();
    error NotMerchant();
    error NotOrderParty();
    error OrderNotFound();

    event OrderFunded(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed merchant,
        uint256 amount,
        uint256 pickupDeadline
    );
    event OrderPreparing(bytes32 indexed orderId);
    event OrderReady(bytes32 indexed orderId);
    event OrderCompleted(bytes32 indexed orderId, uint256 amount);
    event OrderRefunded(bytes32 indexed orderId, uint256 amount, string reason);
    event OrderDisputed(bytes32 indexed orderId, address indexed raisedBy);

    constructor(address usdcAddress, address initialOwner) Ownable(initialOwner) {
        if (usdcAddress == address(0) || initialOwner == address(0)) {
            revert InvalidAddress();
        }
        usdc = IERC20(usdcAddress);
    }

    function fund(
        bytes32 orderId,
        address merchant,
        uint256 amount,
        bytes32 deliveryCodeHash,
        uint256 pickupDeadline
    ) external nonReentrant {
        if (orders[orderId].status != Status.None) revert AlreadyFunded();
        if (merchant == address(0) || merchant == msg.sender) revert InvalidAddress();
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
        if (pickupDeadline <= block.timestamp || pickupDeadline > type(uint64).max) {
            revert InvalidDeadline();
        }
        if (deliveryCodeHash == bytes32(0)) revert InvalidDeliveryCode();

        orders[orderId] = Order({
            buyer: msg.sender,
            merchant: merchant,
            amount: uint128(amount),
            pickupDeadline: uint64(pickupDeadline),
            status: Status.Funded,
            deliveryCodeHash: deliveryCodeHash
        });
        totalLiability += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit OrderFunded(orderId, msg.sender, merchant, amount, pickupDeadline);
    }

    function markPreparing(bytes32 orderId) external {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.merchant) revert NotMerchant();
        _requireStatus(order, Status.Funded);
        order.status = Status.Preparing;
        emit OrderPreparing(orderId);
    }

    function markReady(bytes32 orderId) external {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.merchant) revert NotMerchant();
        _requireStatus(order, Status.Preparing);
        order.status = Status.Ready;
        emit OrderReady(orderId);
    }

    function confirmPickup(
        bytes32 orderId,
        string calldata deliveryCode,
        bytes32 salt
    ) external nonReentrant {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.merchant) revert NotMerchant();
        _requireStatus(order, Status.Ready);
        if (block.timestamp > order.pickupDeadline) revert DeadlinePassed();
        if (computeDeliveryCodeHash(orderId, deliveryCode, salt) != order.deliveryCodeHash) {
            revert InvalidDeliveryCode();
        }

        uint256 amount = order.amount;
        order.status = Status.Completed;
        totalLiability -= amount;
        usdc.safeTransfer(order.merchant, amount);
        emit OrderCompleted(orderId, amount);
    }

    function cancelBeforePreparation(bytes32 orderId) external nonReentrant {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.buyer) revert NotBuyer();
        _requireStatus(order, Status.Funded);
        _refund(orderId, order, "buyer_cancelled");
    }

    function refundAfterDeadline(bytes32 orderId) external nonReentrant {
        Order storage order = _existingOrder(orderId);
        if (block.timestamp <= order.pickupDeadline) revert DeadlineNotPassed();
        if (
            order.status != Status.Funded &&
            order.status != Status.Preparing &&
            order.status != Status.Ready
        ) {
            revert InvalidStatus(order.status, Status.Funded);
        }
        _refund(orderId, order, "pickup_deadline_passed");
    }

    function raiseDispute(bytes32 orderId) external {
        Order storage order = _existingOrder(orderId);
        if (msg.sender != order.buyer && msg.sender != order.merchant) {
            revert NotOrderParty();
        }
        if (
            order.status != Status.Funded &&
            order.status != Status.Preparing &&
            order.status != Status.Ready
        ) {
            revert InvalidStatus(order.status, Status.Funded);
        }
        order.status = Status.Disputed;
        emit OrderDisputed(orderId, msg.sender);
    }

    function refundDispute(bytes32 orderId) external onlyOwner nonReentrant {
        Order storage order = _existingOrder(orderId);
        _requireStatus(order, Status.Disputed);
        _refund(orderId, order, "dispute_refund");
    }

    function computeDeliveryCodeHash(
        bytes32 orderId,
        string calldata deliveryCode,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                PICKUP_DOMAIN,
                block.chainid,
                address(this),
                orderId,
                keccak256(bytes(deliveryCode)),
                salt
            )
        );
    }

    function availableSurplus() external view returns (uint256) {
        return usdc.balanceOf(address(this)) - totalLiability;
    }

    function _existingOrder(bytes32 orderId) internal view returns (Order storage order) {
        order = orders[orderId];
        if (order.status == Status.None) revert OrderNotFound();
    }

    function _requireStatus(Order storage order, Status expected) internal view {
        if (order.status != expected) revert InvalidStatus(order.status, expected);
    }

    function _refund(bytes32 orderId, Order storage order, string memory reason) internal {
        uint256 amount = order.amount;
        order.status = Status.Refunded;
        totalLiability -= amount;
        usdc.safeTransfer(order.buyer, amount);
        emit OrderRefunded(orderId, amount, reason);
    }
}
