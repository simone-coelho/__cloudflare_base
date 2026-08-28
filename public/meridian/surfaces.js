// The rest of the world.
//
// Four surfaces that are not your website. The presenter acts HERE and the page
// answers THERE — which is the bank demo's real invention, generalised from an
// inbox to an ecosystem. Each surface carries the touches its signal contributes,
// so an arrival is an ordinary engine signal, not a special case.

export const SURFACES = {
  retail: [
    {
      id: 'email-outerwear', kind: 'email', from: 'Calder & Co.',
      subject: 'The Autumn Edit is here',
      preview: 'Waxed cotton, wool, and the field jacket we make every year.',
      action: 'Open email',
      chain: ['opened', 'pixel fired', 'identity resolved', 'landed'],
      touches: [{ dim: 'category', value: 'Outerwear' }, { dim: 'styleWorld', value: 'heritage' }],
      hero: { kicker: 'Because you opened The Autumn Edit',
              title: 'The field jacket we make every year',
              body: 'Waxed cotton that earns its keep, and wool that outlives the season.' },
    },
    {
      id: 'ad-bags', kind: 'ad', from: 'Paid social · TikTok',
      subject: 'Carry less, carry it better',
      preview: 'utm_source=tiktok · utm_campaign=autumn_carry',
      action: 'Click the ad',
      chain: ['clicked', 'utm captured', 'campaign matched', 'landed'],
      touches: [{ dim: 'category', value: 'Bags' }, { dim: 'occasion', value: 'travel' }],
      hero: { kicker: 'From your campaign · autumn_carry',
              title: 'Carry less, carry it better',
              body: 'The pieces that campaign was about, first.' },
    },
    {
      id: 'sms-signup', kind: 'sms', from: 'SMS · +1 (917)',
      subject: 'CALDER: you’re on the list',
      preview: 'Early access opens Thursday. Reply STOP to opt out.',
      action: 'Sign up by text',
      chain: ['sent', 'consent captured', 'identity stitched'],
      touches: [{ dim: 'occasion', value: 'gift' }],
      hero: { kicker: 'Welcome back', title: 'Early access opens Thursday',
              body: 'You are on the list. Here is what we would show you first.' },
    },
    {
      id: 'form-quiz', kind: 'form', from: 'Partner site · style quiz',
      subject: 'Declared: evening, statement, premium, the Aster line',
      preview: 'Four taps on a partner survey. No account created.',
      action: 'Submit the form',
      act: 'declared',
      chain: ['submitted', 'declared preference stored', 'joined to observed behaviour'],
      touches: [{ dim: 'occasion', value: 'evening' }, { dim: 'styleWorld', value: 'statement' },
                // Aster is the silk scarves line — the fourth tap names a family, not a fabric.
                { dim: 'priceBand', value: 'premium' }, { dim: 'line', value: 'Aster' }],
      hero: { kicker: 'You told us: evening', title: 'For the evening you said you had',
              body: 'What you told us, alongside what you have actually looked at.' },
    },
  ],
  financial: [
    {
      id: 'email-rate', kind: 'email', from: 'Calder Financial',
      subject: 'Rates moved this week',
      preview: 'Fixed came down. Here is what it means for a first mortgage.',
      action: 'Open email',
      chain: ['opened', 'pixel fired', 'identity resolved', 'landed'],
      touches: [{ dim: 'productFamily', value: 'Mortgage' }, { dim: 'intent', value: 'borrow' }],
      hero: { kicker: 'Because you opened “Rates moved this week”',
              title: 'Fixed came down', body: 'What that changes for a first mortgage, in your state.' },
    },
    {
      id: 'ad-refi', kind: 'ad', from: 'Paid social · Meta',
      subject: 'Stop paying last year’s rate',
      preview: 'utm_source=meta · utm_campaign=refi_autumn',
      action: 'Click the ad',
      chain: ['clicked', 'utm captured', 'campaign matched', 'landed'],
      touches: [{ dim: 'intent', value: 'refinance' }, { dim: 'productFamily', value: 'Mortgage' }],
      hero: { kicker: 'From your campaign · refi_autumn',
              title: 'Stop paying last year’s rate', body: 'Break-even, before you fill in anything.' },
    },
    {
      id: 'sms-alert', kind: 'sms', from: 'SMS · +1 (917)',
      subject: 'CALDER: rate alert set',
      preview: 'We’ll text you when fixed drops below 6%.',
      action: 'Set the alert',
      chain: ['sent', 'consent captured', 'identity stitched'],
      touches: [{ dim: 'intent', value: 'save' }],
      hero: { kicker: 'Alert set', title: 'We will tell you when it moves',
              body: 'Meanwhile, here is where your money can sit.' },
    },
    {
      id: 'form-prequal', kind: 'form', from: 'Partner site · pre-qualification',
      subject: 'Declared: first home, building',
      act: 'declared',
      preview: 'Three fields on a realtor’s site. No account created.',
      action: 'Submit the form',
      chain: ['submitted', 'declared preference stored', 'joined to observed behaviour'],
      touches: [{ dim: 'lifeStage', value: 'building' }, { dim: 'productFamily', value: 'Mortgage' }],
      hero: { kicker: 'You told us: first home', title: 'Buying the first one',
              body: 'What the payment actually looks like, before you fall for a kitchen.' },
    },
  ],
};

export const KIND_LABEL = { email: 'Email', ad: 'Paid social', sms: 'Text message', form: 'Form' };
