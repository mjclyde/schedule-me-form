import { Thing } from "../src/index"
import { assert } from 'chai';

describe('Test', () => {

  it('Should do a thing', () => {
    const foo = new Thing();
    assert.isOk(foo);
  })

})
