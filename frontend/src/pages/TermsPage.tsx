import { Link } from 'react-router-dom';
import { FileText, ArrowLeft } from 'lucide-react';

export default function TermsPage() {
  const effectiveDate = 'April 5, 2026';

  return (
    <div className="h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-6 py-12 pb-24">
        {/* Back link */}
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <header className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <FileText className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
          </div>
          <p className="text-slate-400 ml-14">Effective: {effectiveDate}</p>
        </header>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-slate-300 leading-relaxed">
          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using HVAC DesignPro ("the Service"), a product of <strong>C4 Technologies</strong> ("Company," "we," "us"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not access or use the Service.
            </p>
            <p>
              These Terms apply to all users, including individual practitioners, corporate accounts, and municipal entities accessing the Service through the C4 Technologies Development Center.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              HVAC DesignPro is a web-based progressive web application (PWA) providing:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Manual J heating and cooling load calculations based on ACCA Manual J 8th Edition methodology</li>
              <li>CAD-based floor plan design and duct layout tools</li>
              <li>Equipment sizing and selection assistance</li>
              <li>PDF report generation for permits and client deliverables</li>
              <li>Offline-capable workspace with automatic data synchronization</li>
            </ul>
          </Section>

          <Section title="3. Professional Disclaimer">
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-200/90">
              <p className="font-bold mb-2">IMPORTANT ENGINEERING DISCLAIMER</p>
              <p>
                The Service is a <strong>design-aid tool</strong> and does not replace the professional judgment of a licensed Professional Engineer (PE), registered design professional, or qualified HVAC contractor. All calculations, load estimates, equipment recommendations, and generated reports are provided for <strong>reference and estimation purposes only</strong>.
              </p>
              <p className="mt-2">
                Users are solely responsible for verifying all outputs against applicable building codes, ACCA standards, ASHRAE guidelines, and local jurisdiction requirements before submitting for permit review or using in construction. C4 Technologies makes no warranty that calculations produced by the Service will satisfy any particular code or standard.
              </p>
            </div>
          </Section>

          <Section title="4. User Accounts & Eligibility">
            <p>
              You must be at least 18 years of age and legally authorized to enter into contracts to use the Service. By creating an account, you represent that all information provided is accurate and that you will maintain its accuracy.
            </p>
            <p>
              You are responsible for safeguarding your account credentials. You agree to notify us immediately of any unauthorized access to your account.
            </p>
          </Section>

          <Section title="5. Account Types">
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Individual Accounts:</strong> For sole practitioners and independent contractors. Each individual license is non-transferable.</li>
              <li><strong>Company Accounts:</strong> Multi-user accounts for HVAC firms. The account administrator is responsible for managing team access and compliance with these Terms.</li>
              <li><strong>Municipal Accounts:</strong> For government agencies and permit-issuing authorities. Subject to additional data-handling provisions as required by applicable public records laws.</li>
            </ul>
          </Section>

          <Section title="6. Intellectual Property">
            <p>
              All software, algorithms, user interface designs, documentation, and branding associated with the Service are the exclusive intellectual property of C4 Technologies. You are granted a limited, non-exclusive, revocable license to use the Service for its intended purpose.
            </p>
            <p>
              Project data, floor plans, and calculation results that you create using the Service remain your intellectual property. By using the Service, you grant C4 Technologies a limited license to process and store your data solely for the purpose of providing the Service.
            </p>
          </Section>

          <Section title="7. Acceptable Use">
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Reverse-engineer, decompile, or disassemble any part of the Service</li>
              <li>Use the Service to produce fraudulent engineering documents or false load calculations</li>
              <li>Misrepresent calculations from the Service as PE-stamped or officially certified documents</li>
              <li>Share account credentials or allow unauthorized access to your account</li>
              <li>Use automated systems (bots, scrapers) to access the Service</li>
              <li>Attempt to interfere with the Service's infrastructure or security mechanisms</li>
            </ul>
          </Section>

          <Section title="8. Data Privacy & Security">
            <p>
              The Service operates with a local-first architecture. Project data is stored locally on your device and synchronized to our cloud infrastructure (hosted on Cloudflare) when connected. We implement industry-standard encryption for data in transit (TLS 1.3) and at rest.
            </p>
            <p>
              We do not sell, rent, or share your project data with third parties. Aggregated, anonymized usage analytics may be collected to improve the Service. A full Privacy Policy is available separately.
            </p>
          </Section>

          <Section title="9. Calculation Standards & Compliance">
            <p>
              The Manual J calculation engine implements methodology from:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>ACCA Manual J 8th Edition</strong> — Residential load calculation procedures</li>
              <li><strong>ASHRAE Standard 62.2-2022</strong> — Ventilation and acceptable indoor air quality</li>
              <li><strong>ASHRAE Fundamentals</strong> — Psychrometric data and heat transfer principles</li>
            </ul>
            <p className="mt-2">
              While we strive for accuracy in implementing these standards, the Service is not ACCA-certified software. Users requiring ACCA-certified calculations should verify results against certified tools.
            </p>
          </Section>

          <Section title="10. Limitation of Liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, C4 TECHNOLOGIES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF THE SERVICE.
            </p>
            <p>
              IN NO EVENT SHALL C4 TECHNOLOGIES' TOTAL LIABILITY EXCEED THE AMOUNT YOU HAVE PAID FOR THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
            </p>
            <p>
              C4 Technologies shall not be liable for any damages arising from: (a) incorrect load calculations used without independent professional verification; (b) equipment failures resulting from sizing based solely on Service outputs; (c) permit rejections or code violations; or (d) any personal injury or property damage related to HVAC systems designed using the Service.
            </p>
          </Section>

          <Section title="11. Indemnification">
            <p>
              You agree to indemnify and hold harmless C4 Technologies, its officers, directors, employees, and agents from any claims, liabilities, damages, losses, or expenses arising from: (a) your use of the Service; (b) your violation of these Terms; (c) your violation of any third-party rights; or (d) your submission of Service-generated documents for permits or construction purposes.
            </p>
          </Section>

          <Section title="12. Service Availability & Modifications">
            <p>
              We strive to maintain 99.9% uptime but do not guarantee uninterrupted access. The offline-capable PWA architecture ensures core functionality remains available without internet connectivity.
            </p>
            <p>
              We reserve the right to modify, suspend, or discontinue the Service at any time with reasonable notice. Material changes to these Terms will be communicated via email or in-app notification at least 30 days before taking effect.
            </p>
          </Section>

          <Section title="13. Termination">
            <p>
              Either party may terminate the account at any time. Upon termination, you retain the right to export your project data for 30 days. After that period, data may be permanently deleted from our systems.
            </p>
            <p>
              We may immediately terminate or suspend your account for material violations of these Terms, including but not limited to fraudulent use or unauthorized access attempts.
            </p>
          </Section>

          <Section title="14. Governing Law & Dispute Resolution">
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to conflict of law principles. Any disputes arising from these Terms shall be resolved through binding arbitration administered by the American Arbitration Association, with arbitration proceedings conducted in Delaware.
            </p>
          </Section>

          <Section title="15. Contact Information">
            <p>For questions about these Terms, please contact:</p>
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/30 mt-2">
              <p className="font-bold text-white">C4 Technologies</p>
              <p>Development Center</p>
              <p className="text-slate-400 mt-1">Legal Department</p>
              <p className="text-emerald-400">legal@c4technologies.dev</p>
            </div>
          </Section>

          <div className="border-t border-slate-800/60 pt-6 mt-10 text-center text-xs text-slate-600">
            <p>&copy; {new Date().getFullYear()} C4 Technologies. All rights reserved.</p>
            <p className="mt-1">HVAC DesignPro is a trademark of C4 Technologies.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-white mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
