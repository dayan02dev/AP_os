export const NAV_ADMIN = [
  { label:'Pipeline', entries:[
    { id:'dashboard', num:'A-0', label:'Dashboard Home' },
    { id:'pipeline',  num:'A-1', label:'Application Intake' },
    { id:'detail',    num:'A-2', label:'Application Detail' },
  ]},
  { label:'Evaluation & Decisions', entries:[
    { id:'reviewers', num:'A-3', label:'Reviewer Mgmt' },
    { id:'gate1',     num:'A-4', label:'Gate 1 Review', badge:'12' },
    { id:'psychometry', num:'A-5', label:'Psychometry Mgmt' },
    { id:'jury',      num:'A-6', label:'Jury Mgmt' },
    { id:'gate2',     num:'A-7', label:'Gate 2 Final' },
  ]},
  { label:'System & Analytics', entries:[
    { id:'audit',     num:'A-8', label:'Audit Log' },
    { id:'analytics', num:'A-9', label:'Analytics Dashboard' },
  ]},
];
