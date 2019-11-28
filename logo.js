var figlet = require('figlet');
 
module.exports = figlet.textSync('GitServer', { font: 'Cyberlarge' })

if (!module.parent) {
  console.log(module.exports)
}

console.log(`
                          @@@@@@@@@@@@@@@@@@          
                              @@@    @@@               
                                @@  @@      @@         
                                @@  @@      @@         
                   @@@@@@@@@@   @@  @@   @@@@@@@@@     
                  @@    @@@     @@  @@      @@        
                 @@      @@     @@  @@      @@         
                  @@    @@@     @@  @@      @@         
                  @@@@@@@@      @@  @@      @@         
                 @@             @@  @@      @@        
                  @@@@@@@@@     @@  @@      @@        
                 @@       @@@   @@  @@      @@        
                @@@       @@    @@  @@      @@@       
                  @@@@@@@@@     @@  @@        @@@@     
                              @@@    @@@                
                          @@@@@@@@@@@@@@@@@@          
                                                       
                                                       `)
