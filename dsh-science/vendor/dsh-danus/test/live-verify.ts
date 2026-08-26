import { DanusVerify } from '../src/services/verify.ts'

const v = new DanusVerify({ stateDir: 'D:/AIWORK/DSH PLUGIN DEV/CAM ZHB/runtime/danus/verify' })
try {
  const r = await v.verify(
    'For every positive integer n, the sum 1 + 3 + 5 + ... + (2n-1) of the first n odd positive integers equals n^2.',
    'We induct on n. Base case n=1: the sum is 1 = 1^2, true. Inductive step: assume the claim for some n >= 1, i.e. the sum of the first n odd numbers is n^2. The (n+1)-th odd number is 2n+1. Adding it to both sides gives the sum of the first n+1 odd numbers as n^2 + 2n + 1 = (n+1)^2, which is the claim for n+1. By the principle of mathematical induction the identity holds for all positive integers n.',
  )
  console.log('VERDICT:', JSON.stringify(r))
} catch (e) {
  const err = e as { status?: number; message?: string }
  console.log('VERIFY ERROR:', err.status ?? '', err.message ?? String(e))
}
