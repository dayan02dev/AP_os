// ARTPARK OS — Shared mock data (window-scoped)
window.OS_DATA = (function(){
  const STARTUPS = [
    { id:'s01', name:'Karkhana Robotics', founders:['Aanya Mehta','Rohit Kapoor'], domain:'Robotics & Automation', stage:'Pilot-ready', trl:5, sub:'12 Apr 2026', flag:'darkgreen', completeness:92,
      ai:{ overall:8.4, conf:92, problem:8.6, solution:8.2, tech:9.0, founders:7.8, commit:8.4, integrity:8.4 },
      rev:{ overall:7.9, problem:8.0, solution:7.5, tech:8.5, founders:7.5, commit:8.0, integrity:8.0, reco:'yes', notes:'Strong technical team, deck is tight. Tech score may be a touch high — they over-claim throughput.', disagreements: { tech: 'Reviewer feels the tech throughput claims are slightly exaggerated.' } },
      jury:{ potential:8.5, fit:8.0, defensibility:7.5, reco:'approve' },
      flags:['Throughput claim unverified'], variance:0.5,
      tags:['HealthTech adjacent'], chip:'EVALUATED' },
    { id:'s02', name:'Saathi Health AI', founders:['Dr. Priya Iyer','Vikram Shah','Neha Bhat'], domain:'Healthcare / MedTech', stage:'Prototype', trl:6, sub:'14 Apr 2026', flag:'darkgreen', completeness:88,
      ai:{ overall:8.9, conf:94, problem:9.2, solution:8.8, tech:8.5, founders:9.0, commit:9.0, integrity:8.8 },
      rev:{ overall:8.6, problem:9.0, solution:8.5, tech:8.0, founders:9.0, commit:9.0, integrity:8.0, reco:'yes', notes:'Best problem-statement in batch. Team has clinical credibility.' },
      jury:{ potential:9.0, fit:9.0, defensibility:8.0, reco:'approve' },
      flags:[], variance:0.3, chip:'SHORTLISTED', adminDecision: 'APPROVED' },
    { id:'s03', name:'GridPulse', founders:['Arjun Rao','Mira Sen'], domain:'Climate Fintech / Urban Resilience', stage:'Pilot-ready', trl:4, sub:'10 Apr 2026', flag:'green', completeness:74,
      ai:{ overall:7.2, conf:81, problem:7.8, solution:7.0, tech:7.5, founders:6.5, commit:7.2, integrity:7.0 },
      rev:{ overall:5.8, problem:6.5, solution:5.5, tech:6.0, founders:5.0, commit:6.0, integrity:6.0, reco:'maybe', notes:'I disagree on Founders score — sole founder, no team yet. Idea is real, execution risk high.', disagreements: { founders: 'Sole founder, no team yet. Idea is real, execution risk high.' } },
      flags:['Single founder','Pilot data not shared'], variance:1.4, chip:'EVALUATED' },
    { id:'s04', name:'Lumen Surgical', founders:['Dr. Kabir Joshi','Anika Reddy'], domain:'Healthcare / MedTech', stage:'Lab demo', trl:7, sub:'09 Apr 2026', flag:'darkgreen', completeness:95,
      ai:{ overall:8.1, conf:90, problem:8.0, solution:8.5, tech:8.8, founders:7.5, commit:8.0, integrity:8.0 },
      rev:{ overall:8.3, problem:8.5, solution:8.5, tech:9.0, founders:7.5, commit:8.0, integrity:8.5, reco:'yes', notes:'Regulatory pathway looks plausible. Strong IP.' },
      jury:{ potential:8.0, fit:8.5, defensibility:9.0, reco:'approve' },
      flags:[], variance:0.2, chip:'JURY REVIEW' },
    { id:'s05', name:'Tarang Acoustics', founders:['Ishaan Patel'], domain:'Robotics & Automation', stage:'Research', trl:3, sub:'11 Apr 2026', flag:'orange', completeness:54,
      ai:{ overall:5.4, conf:62, problem:6.0, solution:5.5, tech:6.5, founders:4.5, commit:5.0, integrity:5.0 },
      rev:{ overall:5.1, problem:5.5, solution:5.0, tech:6.0, founders:4.5, commit:5.0, integrity:5.0, reco:'no', notes:'Too early. Pitch deck thin.' },
      flags:['No team','GitHub link 404','Pitch deck missing financial plan'], variance:0.3, chip:'IN REVIEW' },
    { id:'s06', name:'Anvaya Bio', founders:['Sneha Krishnan','Devansh Gupta'], domain:'Healthcare / MedTech', stage:'Active pilots', trl:5, sub:'13 Apr 2026', flag:'darkgreen', completeness:86,
      ai:{ overall:7.8, conf:88, problem:8.0, solution:7.5, tech:8.0, founders:7.5, commit:8.0, integrity:7.5 },
      rev:{ overall:7.2, problem:7.5, solution:7.0, tech:7.5, founders:7.0, commit:7.5, integrity:7.0, reco:'yes', notes:'Solid science but slow commercial path.' },
      jury:{ potential:7.5, fit:7.0, defensibility:8.5, reco:'waitlist' },
      flags:['Long horizon to revenue'], variance:0.6, chip:'JURY REVIEW', adminDecision: 'APPROVED' },
    { id:'s07', name:'Drishti Vision', founders:['Karan Malhotra','Tanvi Joshi','Sahil Rao'], domain:'Artificial Intelligence / Foundational Models', stage:'Lab demo', trl:4, sub:'08 Apr 2026', flag:'green', completeness:70,
      ai:{ overall:6.8, conf:78, problem:7.0, solution:6.5, tech:7.5, founders:7.0, commit:6.5, integrity:6.0 },
      rev:{ overall:7.5, problem:7.5, solution:7.5, tech:8.0, founders:7.5, commit:7.0, integrity:7.5, reco:'yes', notes:'Reviewer sees more upside than AI. Founders are seasoned.' },
      flags:[], variance:0.7, chip:'EVALUATED' },
    { id:'s08', name:'Yantra Mobility', founders:['Aditi Shenoy','Ravi Pillai'], domain:'Robotics & Automation', stage:'Lab demo', trl:6, sub:'07 Apr 2026', flag:'darkgreen', completeness:90,
      ai:{ overall:7.5, conf:85, problem:7.5, solution:7.5, tech:8.0, founders:7.5, commit:7.0, integrity:7.5 },
      rev:{ overall:8.5, problem:8.5, solution:9.0, tech:9.0, founders:8.0, commit:8.5, integrity:8.0, reco:'yes', notes:'Underrated by AI. The integration story is compelling.' },
      flags:['Variance with AI on Solution'], variance:1.0, chip:'EVALUATED' },
    { id:'s09', name:'Pravaha Water', founders:['Meera Krishnamurthy'], domain:'Climate Fintech / Urban Resilience', stage:'Pilot-ready', trl:5, sub:'15 Apr 2026', flag:'darkgreen', completeness:84,
      ai:{ overall:7.0, conf:83, problem:8.5, solution:7.0, tech:7.5, founders:6.5, commit:6.5, integrity:6.0 },
      flags:[], variance:null, chip:'PROCESSING' },
    { id:'s10', name:'Kaleido Quantum', founders:['Dr. Aman Khanna'], domain:'Other / Frontier', stage:'Research', trl:2, sub:'16 Apr 2026', flag:'orange', completeness:48,
      ai:{ overall:5.0, conf:55, problem:5.5, solution:4.5, tech:6.5, founders:5.0, commit:4.5, integrity:4.0 },
      flags:['Pitch deck < 3 pages','No prototype evidence'], chip:'NEW' },
    { id:'s11', name:'Bandhu AgriCare', founders:['Pooja Nair','Siddharth Iyer'], domain:'Other / Frontier', stage:'Active pilots', trl:6, sub:'06 Apr 2026', flag:'darkgreen', completeness:88,
      ai:{ overall:8.0, conf:91, problem:8.5, solution:8.0, tech:7.5, founders:8.5, commit:8.0, integrity:7.5 },
      rev:{ overall:8.0, problem:8.0, solution:8.0, tech:7.5, founders:8.5, commit:8.0, integrity:8.0, reco:'yes' },
      jury:{ potential:8.5, fit:8.5, defensibility:7.0, reco:'approve' },
      flags:[], variance:0.0, chip:'ACCEPTED', adminDecision: 'APPROVED' },
    { id:'s12', name:'Lithos Materials', founders:['Aryan Banerjee','Ishita Roy'], domain:'Other / Frontier', stage:'Prototype', trl:3, sub:'05 Apr 2026', flag:'green', completeness:68,
      ai:{ overall:6.0, conf:74, problem:6.5, solution:6.0, tech:7.0, founders:5.5, commit:5.5, integrity:6.0 },
      rev:{ overall:5.5, problem:6.0, solution:5.0, tech:6.5, founders:5.5, commit:5.0, integrity:5.0, reco:'no' },
      flags:[], variance:0.5, chip:'REJECTED', adminDecision: 'REJECTED' },
    { id:'s13', name:'Saavera Mobility', founders:['Rishabh Verma','Anjali Menon'], domain:'EV Mobility & Services', stage:'Lab demo', trl:6, sub:'04 Apr 2026', flag:'darkgreen', completeness:82,
      ai:{ overall:7.6, conf:87, problem:7.5, solution:8.0, tech:7.5, founders:7.5, commit:7.5, integrity:7.5 },
      rev:{ overall:7.4, problem:7.5, solution:7.5, tech:7.5, founders:7.0, commit:7.5, integrity:7.0, reco:'yes' },
      jury:{ potential:7.5, fit:8.0, defensibility:7.0, reco:'approve' },
      flags:[], variance:0.2, chip:'JURY REVIEW' },
    { id:'s14', name:'Vidyut Storage', founders:['Hrithik Sharma'], domain:'Climate Fintech / Urban Resilience', stage:'Research', trl:4, sub:'03 Apr 2026', flag:'green', completeness:72,
      ai:{ overall:6.5, conf:79, problem:7.0, solution:6.5, tech:7.0, founders:6.0, commit:6.0, integrity:6.5 },
      rev:{ overall:7.8, problem:8.0, solution:8.0, tech:8.0, founders:7.5, commit:7.5, integrity:7.5, reco:'yes', notes:'Reviewer thinks AI under-scored. Push to next round.' },
      flags:['Variance >1.0'], variance:1.3, chip:'EVALUATED' },
    { id:'s15', name:'Mihira Diagnostics', founders:['Dr. Tara Pillai','Yash Goyal'], domain:'Healthcare / MedTech', stage:'Active pilots', trl:7, sub:'01 Apr 2026', flag:'darkgreen', completeness:96,
      ai:{ overall:8.7, conf:93, problem:9.0, solution:8.5, tech:8.5, founders:9.0, commit:8.5, integrity:8.5 },
      rev:{ overall:8.8, problem:9.0, solution:8.5, tech:9.0, founders:9.0, commit:8.5, integrity:8.5, reco:'yes' },
      jury:{ potential:9.0, fit:9.0, defensibility:8.5, reco:'approve' },
      flags:[], variance:0.1, chip:'ACCEPTED', adminDecision: 'APPROVED' },
    { id:'s16', name:'Nakshatra Drones', founders:['Aakash Pillai','Riya Bose'], domain:'Robotics & Automation', stage:'Pilot-ready', trl:5, sub:'02 Apr 2026', flag:'green', completeness:76,
      ai:{ overall:7.0, conf:84, problem:7.0, solution:7.5, tech:7.5, founders:6.5, commit:7.0, integrity:6.5 },
      rev:{ overall:7.2, problem:7.0, solution:7.5, tech:7.5, founders:7.0, commit:7.0, integrity:7.0, reco:'maybe' },
      jury:{ potential:7.0, fit:7.5, defensibility:6.5, reco:'waitlist' },
      flags:[], variance:0.2, chip:'WAITLISTED', adminDecision: 'HOLD' },
  ];
  const REVIEWERS = [
    { id:'r1', name:'Vikram Sundar', domain:'Robotics, Mobility', batch:'Batch A', progress:'9 / 12', consistency:0.92, last:'2h ago', weight: 2.0 },
    { id:'r2', name:'Dr. Aishwarya Pillai', domain:'HealthTech, MedDevice', batch:'Batch B', progress:'7 / 10', consistency:0.88, last:'45m ago', weight: 1.0 },
    { id:'r3', name:'Karthik Subramanian', domain:'CleanTech, Materials', batch:'Batch C', progress:'5 / 8', consistency:0.81, last:'5h ago', weight: 1.0 },
    { id:'r4', name:'Nidhi Bansal', domain:'AI/CV, AgriTech', batch:'Batch D', progress:'10 / 10', consistency:0.95, last:'1d ago', weight: 1.0 },
    { id:'r5', name:'Prof. Rahul Iyengar', domain:'BioTech, DeepTech', batch:'Batch E', progress:'3 / 6', consistency:0.74, last:'12h ago', weight: 1.0 },
    { id:'r6', name:'Priya Sharma', domain:'CleanTech, AgriTech', batch:'Batch A', progress:'8 / 10', consistency:0.89, last:'3h ago', weight: 1.0 },
    { id:'r7', name:'Amit Patel', domain:'DeepTech, SaaS', batch:'Batch B', progress:'6 / 9', consistency:0.87, last:'1h ago', weight: 1.0 },
  ];
  const JURY = [
    { id:'j1', name:'Anand Mahindra', org:'M&M Group' },
    { id:'j2', name:'Kiran Mazumdar-Shaw', org:'Biocon' },
    { id:'j3', name:'Nandan Nilekani', org:'Infosys' },
    { id:'j4', name:'Falguni Nayar', org:'Nykaa' },
  ];
  const ACTIVITY = [
    { ts:'10:42', actor:'AI Pipeline', what:'completed scoring for Pravaha Water', type:'ai' },
    { ts:'10:31', actor:'Vikram Sundar', what:'submitted evaluation · Karkhana Robotics', type:'rev' },
    { ts:'10:14', actor:'Founder', what:'new submission · Kaleido Quantum', type:'sub' },
    { ts:'09:58', actor:'Dr. Aishwarya Pillai', what:'flagged variance on GridPulse', type:'flag' },
    { ts:'09:46', actor:'Admin', what:'sent 5 to Psychometry · Gate 1', type:'gate' },
    { ts:'09:22', actor:'AI Pipeline', what:'completed scoring for Tarang Acoustics', type:'ai' },
    { ts:'08:55', actor:'Cohort Mgr', what:'nudged 3 orange-flag applicants', type:'cm' },
    { ts:'08:33', actor:'Anand Mahindra', what:'submitted jury eval · Lumen Surgical', type:'jury' },
  ];
  const NOTIFICATIONS_FOUNDER = [
    { ts:'2 days ago', title:'You\'re shortlisted — please complete the psychometry test', body:'Congratulations. Our team has reviewed your application and would like to invite you to the next stage.', unread:true, action:true },
    { ts:'5 days ago', title:'Your application is under review', body:'Our reviewers are evaluating applications now. We will notify you within 7 days.', unread:false },
    { ts:'12 Apr 2026', title:'Application received — thank you', body:'We have received your TIR application. You\'ll hear from us shortly.', unread:false },
  ];
  let data = { STARTUPS, REVIEWERS, JURY, ACTIVITY, NOTIFICATIONS_FOUNDER };

  // Set default startup batches dynamically if not set
  data.STARTUPS.forEach((s, idx) => {
    if (!s.batch) {
      if (idx < 3) s.batch = 'Batch A';
      else if (idx < 6) s.batch = 'Batch B';
      else if (idx < 9) s.batch = 'Batch C';
      else if (idx < 12) s.batch = 'Batch D';
      else s.batch = 'Batch E';
    }
  });

  const saved = localStorage.getItem('ARTPARK_OS_DATA');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        if (parsed.STARTUPS && Array.isArray(parsed.STARTUPS) && parsed.STARTUPS.length > 0) {
          parsed.STARTUPS = parsed.STARTUPS.map(ps => {
            const ds = data.STARTUPS.find(x => x.id === ps.id);
            if (ds) {
              const merged = {
                ...ds,
                ...ps,
                rev: ps.rev ? { ...ds.rev, ...ps.rev, disagreements: ps.rev.disagreements || ds.rev?.disagreements } : ds.rev
              };
              merged.stage = ds.stage;
              return merged;
            }
            return ps;
          });
          data.STARTUPS = parsed.STARTUPS;
        }

        if (parsed.REVIEWERS && Array.isArray(parsed.REVIEWERS) && parsed.REVIEWERS.length > 0) {
          data.REVIEWERS = parsed.REVIEWERS;
        }

        if (parsed.JURY && Array.isArray(parsed.JURY) && parsed.JURY.length > 0) {
          data.JURY = parsed.JURY;
        }

        if (parsed.ACTIVITY && Array.isArray(parsed.ACTIVITY) && parsed.ACTIVITY.length > 0) {
          data.ACTIVITY = parsed.ACTIVITY;
        }

        if (parsed.NOTIFICATIONS_FOUNDER && Array.isArray(parsed.NOTIFICATIONS_FOUNDER) && parsed.NOTIFICATIONS_FOUNDER.length > 0) {
          data.NOTIFICATIONS_FOUNDER = parsed.NOTIFICATIONS_FOUNDER;
        }
      }
      
      // Ensure JURY array is non-empty and correctly initialized
      if (!data.JURY || !Array.isArray(data.JURY) || data.JURY.length === 0) {
        data.JURY = JURY;
      }
    } catch(e) {
      console.error("Failed to load saved state", e);
    }
  } else {
    localStorage.setItem('ARTPARK_OS_DATA', JSON.stringify(data));
  }

  window.persistOSData = function() {
    localStorage.setItem('ARTPARK_OS_DATA', JSON.stringify(window.OS_DATA));
  };

  return data;
})();
