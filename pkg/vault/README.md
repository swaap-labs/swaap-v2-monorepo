<img src="https://docs.swaap.finance/img/brand.png" alt="drawing" width="300"/>

# Swaap V2 Vault

[![NPM Package](https://img.shields.io/npm/v/@swaap-labs/v2-vault.svg)](https://www.npmjs.org/package/@swaap-labs/v2-vault)

This package contains the Swaap V2's [`Vault`](./contracts/Vault.sol), a fork of Balancer V2's Vault (cf. [`here`](https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/vault/contracts/Vault.sol)). Only [PoolBalances.sol](./contracts/PoolBalances.sol) have been modified in order to address the known issue described [here](https://forum.balancer.fi/t/reentrancy-vulnerability-scope-expanded/4345).

To get the Solidity interface of the Vault and related contracts, refer to [`Balancer's v2-interfaces`](https://github.com/balancer/balancer-v2-monorepo/tree/master/pkg/interfaces) package.

## Overview

### Installation

```console
$ npm install @swaap-labs/v2-vault
```

## Licensing

[GNU General Public License Version 3 (GPL v3)](../../LICENSE).
