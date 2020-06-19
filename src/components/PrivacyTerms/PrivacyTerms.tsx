import React from 'react';
import ReactMarkdown from 'react-markdown';

const mdStyle = { color: 'white', margin: '50px', maxWidth: '800px' };

export const Privacy = () => {
  return (
    <div style={mdStyle}>
      <ReactMarkdown>
        {`
Privacy Policy
====
- Rooms are temporary and expire after one day of inactivity.
- We do not keep logs of the content that users watch.

Personal Information
----
- You are not required to register to use the service, but you have the option to sign in with an email or authentication provider, which will be used to display your name and picture in the rooms you join.
- If you provide this information, we may use it to contact you regarding your use of the service, or to link your account to a subscription.
- We do not sell personal information to third parties.
- You have the right to request deletion of your user data, in accordance with various laws governing data protection.
- Payment information is handled by providers such as Stripe. We do not collect or access financial information directly.

Cookies
----
- We use services such as Google Analytics to measure usage. These services may set cookies or other information locally on your device.

Virtual Browsers
----
- Virtual machines are recycled after each session ends and any data on them is destroyed.
- Your commands are encrypted while in-transit to the virtual machine.
`}
      </ReactMarkdown>
    </div>
  );
};

export const Terms = () => {
  return (
    <div style={mdStyle}>
      <ReactMarkdown>
        {`
Terms of Service
====
By using this service you agree to the following terms:
- You are over 13 years of age
- Your use of the service may be terminated if you are found to be sharing illegal or infringing content
- The service provides no guarantee of uptime or availability
- You use the service at your own risk of encountering objectionable content, as we do not actively moderate rooms unless content is found to be illegal or infringing
`}
      </ReactMarkdown>
    </div>
  );
};

export const FAQ = () => {
  return (
    <div style={mdStyle}>
      <ReactMarkdown>
        {`
FAQ
====
Does everyone in the room need to be a subscriber to get the benefits?
----
No, only the person who created the VBrowser needs to be.

How do I access some sites that have a "not available" message in the VBrowser?
----
Some sites may block traffic that's detected as coming from certain geographic regions. You may need to install an extension like Hola VPN inside the virtual browser.

Is there a limit to how many people can be in a room?
----
Currently there isn't a hard limit, although the service hasn't been tested with more than 15 people or so. Screensharing and filesharing rely on one person uploading to everyone else, so it may not work well with large room sizes.
`}
      </ReactMarkdown>
    </div>
  );
};