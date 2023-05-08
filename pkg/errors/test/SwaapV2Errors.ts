import { expect } from 'chai';
import { Contract } from 'ethers';

import { deploy } from '@balancer-labs/v2-helpers/src/contract';

describe('SwaapV2Errors', function () {
  let errors: Contract;

  beforeEach('deploy errors', async () => {
    errors = await deploy('SwaapV2ErrorsMock');
  });

  it('encodes the error code as expected', async () => {
    await expect(errors.fail(42)).to.be.revertedWith('SWAAP#42');
  });

  it('translates the error code to its corresponding string if existent', async () => {
    await expect(errors.fail(25)).to.be.revertedWith('SWAAP#25');
  });

  it('encodes the prefix as expected', async () => {
    await expect(errors.failWithPrefix(42)).to.be.revertedWith('SWAAP#42');
  });
});