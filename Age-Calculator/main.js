document.querySelector('button').addEventListener('click', cal_age)

function cal_age(){
    const current_date =  new Date()
    const DOB = document.querySelector('#birthday').value

    if(DOB === ''){
        alert('Enter Your DOB')
    }
    else{
        let age = getAge(DOB,current_date)
        console.log(age)
        document.querySelector('#result').innerText = `Your age is ${age} ${age > 1 ? 'years': 'year'} old `
    }
    
}

function getAge(DOB,current_date){
  
        let birth_year = new Date(DOB)
        let age = current_date.getFullYear() - birth_year.getFullYear()
        let month = current_date.getMonth() - birth_year.getMonth()

       if(month < 0 || (month == 0 && current_date.getDate()< birth_year.getDate())){
        age --
       }

    return age;

}

